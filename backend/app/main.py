from fastapi import FastAPI, File, UploadFile, BackgroundTasks
from uuid import uuid4
from app.storage import upload_files_to_s3
from app.database import save_pipeline_run, get_pipeline_run_status
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Response, HTTPException
from fastapi.responses import FileResponse
import boto3
import json
import base64
import asyncio
import logging
import os
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000",
                   "http://localhost:3000",
                   "http://localhost:5173",
                   "http://3.24.34.21",
                   "http://antimicrobialresistance.cloud"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add this near the top with your other imports if not already present
BASE_DIR = Path(__file__).resolve().parent.parent.parent

@app.post("/notify_completion")
async def check_completion_marker(run_id: str):
    logger.info(f"Completion notification received for run_id: {run_id}")
    s3 = boto3.client('s3')
    try:
        s3.head_object(Bucket="cloudresoutput", Key=f"{run_id}/completion_marker.txt")
        logger.info(f"Completion marker found for {run_id}, updating database")
        save_pipeline_run(run_id, status="completed", results=None)
        return {"status": "completed"}
    except Exception as e:
        logger.info(f"Completion marker not found for {run_id}: {e}")
        return {"status": "running"}

@app.post("/upload")
async def upload_fastq(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...)
):
    run_id = str(uuid4())
    logger.info(f"New upload with run_id: {run_id}")
    s3_paths = upload_files_to_s3(run_id, files)
    save_pipeline_run(run_id, status="running", results=None)
    background_tasks.add_task(trigger_pipeline, run_id, s3_paths)
    # Add background task to check completion
    background_tasks.add_task(poll_completion, run_id)
    return {"run_id": run_id, "status": "Pipeline started"}

async def poll_completion(run_id: str):
    """Background task to poll for completion marker in S3"""
    logger.info(f"Started background polling for run_id: {run_id}")
    
    # Sleep 5 minutes before starting to check - allows EC2 to boot up and start working
    await asyncio.sleep(300)
    
    # Poll every 5 minutes for up to 6 hours
    for i in range(72):  # 72 * 5 minutes = 6 hours
        logger.info(f"Checking completion for run_id {run_id} (attempt {i+1})")
        try:
            s3 = boto3.client('s3')
            s3.head_object(Bucket="cloudresoutput", Key=f"{run_id}/completion_marker.txt")
            # Marker found, update database
            logger.info(f"Completion marker found for run_id {run_id}")
            save_pipeline_run(run_id, status="completed", results=None)
            return
        except Exception as e:
            logger.info(f"Completion marker not found for run_id {run_id}: {str(e)}")
            pass
        
        # Sleep for 5 minutes before checking again
        await asyncio.sleep(300)
    
    # If we get here, the pipeline timed out
    logger.warning(f"Pipeline run {run_id} timed out after 6 hours")
    save_pipeline_run(run_id, status="timed_out", results=None)

def trigger_pipeline(run_id: str, s3_paths: list[str]):
    try:
        print(f"Starting EC2 launch for run_id: {run_id}")

        ec2 = boto3.client('ec2', region_name='ap-southeast-2')

        params_json = json.dumps({"s3_paths": s3_paths, "run_id": run_id})

        user_data = f"""#!/bin/bash
        sudo -i
        set -e
        set -x

        date
        echo "Updating package lists..."
        sudo yum update -y
        date

        echo "Installing AWS CLI..."
        sudo yum install -y aws-cli
        date

        echo "Creating run directory..."
        sudo mkdir -p /home/ec2-user/runs/
        date

        echo "Creating params.json..."
        echo '{params_json}' > /home/ec2-user/runs/params.json
        date

        echo "Extracting run_id from params.json..."
        run_id=$(jq -r '.run_id' /home/ec2-user/runs/params.json)
        date
        echo "run_id: ${{run_id}}"

        echo "Creating run_id directory..."
        sudo mkdir -p /home/ec2-user/runs/${{run_id}}
        date

        echo "Changing directory to run directory..."
        cd /home/ec2-user/runs/${{run_id}}
        date

        echo "Copying data from S3..."
        for s3_path in $(jq -r '.s3_paths[]' /home/ec2-user/runs/params.json); do
          aws s3 cp "$s3_path" .
        done
        mkdir -p /home/ec2-user/hostile/
        aws s3 sync s3://hostile/hostile /home/ec2-user/hostile 
        date

        echo "Installing Java..."
        sudo yum install -y java-11-amazon-corretto-headless
        date

        echo "Installing Nextflow..."
        curl -fsSL get.nextflow.io | bash
        sudo mv nextflow /usr/local/bin/
        date

        echo "Installing git..."
        sudo yum install -y git
        date

        echo "Installing jq..."
        sudo yum install -y jq
        date

        echo "Installing Docker..."
        sudo sudo yum install -y docker
        sudo service docker start
        date

        echo "Cloning nextflow repo..."
        mkdir -p /home/ec2-user/cloudres/
        git clone https://github.com/maxlcummins/cloudres /home/ec2-user/cloudres/
        date

        echo "Preparing sample sheet for nextflow run..."
        SAMPLE_SHEET="/home/ec2-user/runs/${{run_id}}/samplesheet.csv"

        # Start with the header
        echo "sample,fastq_1,fastq_2" > "$SAMPLE_SHEET"

        # Find all R1 files
        echo "Listing files in directory..."
        ls -l
        echo "Finding R1 files..."
        for fastq_r1 in $(ls | grep -E "(_R1|_1)" | sort); do
            echo "Found R1 file: $fastq_r1"
            # For each R1 file, find the matching R2 file
            sample_name=$(basename "$fastq_r1" | sed 's/_R1.*//')
            echo "Sample name: $sample_name"
            # Look for matching R2 file
            fastq_r2=$(ls | grep -E "$sample_name.*(_R2|_2)" | head -n 1)

            if [ ! -z "$fastq_r2" ]; then
                echo "Adding sample: $sample_name"
                echo "$sample_name,/home/ec2-user/runs/${{run_id}}/$fastq_r1,/home/ec2-user/runs/${{run_id}}/$fastq_r2" >> "$SAMPLE_SHEET"
            else
                echo "WARNING: No matching R2 file found for $fastq_r1"
            fi
        done

        echo "Sample sheet created at: $SAMPLE_SHEET"
        echo "Contents of sample sheet:"
        cat "$SAMPLE_SHEET"

        echo "Running nextflow..."
        nextflow run /home/ec2-user/cloudres/main.nf -profile docker --hostile_db /home/ec2-user/hostile/ --input $SAMPLE_SHEET --genome_size 5000000 -work-dir work --outdir /home/ec2-user/runs/${{run_id}}/results/
        date

        echo "Uploading results..."
        aws s3 sync /home/ec2-user/runs/${{run_id}}/results/ s3://cloudresoutput/${{run_id}}/results/
        date

        # Create completion marker BEFORE we terminate
        echo "Notifying of completion via S3..."
        echo "" > /tmp/empty.txt
        aws s3 cp /tmp/empty.txt s3://cloudresoutput/${{run_id}}/completion_marker.txt

        
        echo "User data script complete."
        """
        
        logger.info(f"User Data length: {len(user_data)}")
        encoded_user_data = base64.b64encode(user_data.encode('utf-8')).decode('utf-8')

        response = ec2.run_instances(
            LaunchTemplate={'LaunchTemplateId': 'lt-05c9e523b50df738d'},
            MinCount=1,
            MaxCount=1,
            UserData=encoded_user_data
        )

        instance_id = response['Instances'][0]['InstanceId']
        logger.info(f"EC2 instance launched: {instance_id}")
        
        # Store instance ID for the run for later reference
        save_pipeline_run(run_id, status="running", results={"instance_id": instance_id})

    except Exception as e:
        logger.error(f"Error launching EC2 instance: {e}")
        save_pipeline_run(run_id, status="failed", results={"error": str(e)})

@app.post("/notify_completion")
async def check_completion_marker(run_id: str):
    logger.info(f"Completion notification received for run_id: {run_id}")
    s3 = boto3.client('s3')
    try:
        s3.head_object(Bucket="cloudresoutput", Key=f"{run_id}/completion_marker.txt")
        logger.info(f"Completion marker found for {run_id}, updating database")
        save_pipeline_run(run_id, status="completed", results=None)
        return {"status": "completed"}
    except Exception as e:
        logger.info(f"Completion marker not found for {run_id}: {e}")
        return {"status": "running"}

@app.get("/status")
async def get_status(run_id: str):
    """
    Check the status of the pipeline run.
    """
    logger.info(f"Status check for run_id: {run_id}")
    
    # Check S3 marker directly
    try:
        s3 = boto3.client('s3')
        s3.head_object(Bucket="cloudresoutput", Key=f"{run_id}/completion_marker.txt")
        logger.info(f"S3 marker found for {run_id}")
        return {"status": "completed"}  # Return completed status immediately
    except Exception as e:
        logger.info(f"S3 marker not found: {str(e)}")
        return {"status": "processing"}  # Or another appropriate status

@app.get("/results")
async def get_results(run_id: str):
    """
    Retrieve the results from S3 for the given run_id.
    """
    logger.info(f"Results request for run_id: {run_id}")
    
    # Development mode: Return mock results for test IDs
    if run_id.startswith("test-"):
        mock_results = """sample,species,ST,hits
TESTDATA123,Escherichia coli,131,blaCTX-M-15:100.00:936/956"""
        return Response(content=mock_results, media_type="text/plain")
    
    # First check if run is complete in database
    run_status = get_pipeline_run_status(run_id)
    logger.info(f"Database status for {run_id}: {run_status}")
    
    # If not completed in database, check S3 marker directly
    if run_status != "completed":
        try:
            s3 = boto3.client('s3')
            s3.head_object(Bucket="cloudresoutput", Key=f"{run_id}/completion_marker.txt")
            logger.info(f"S3 marker found for {run_id}")
            # Update status if marker exists
            save_pipeline_run(run_id, status="completed", results=None)
            # Continue to results retrieval instead of returning early
        except Exception as e:
            logger.info(f"S3 marker not found: {str(e)}")
            # No marker exists, return status
            return Response(content=f"Pipeline status: {run_status}", media_type="text/plain", status_code=202)
    
    s3 = boto3.client('s3')
    bucket_name = "cloudresoutput"
    prefix = f"{run_id}/results/csvtk/" # Final output folder here
    
    try:
        # List objects in the directory first
        logger.info(f"Listing objects in s3://{bucket_name}/{prefix}")
        response = s3.list_objects_v2(Bucket=bucket_name, Prefix=prefix)
        logger.info(f"Response from list_objects_v2: {response}")  # Log the entire response

        # Check if the directory exists and has contents
        if 'Contents' not in response:
            logger.info(f"No results directory found for {run_id}")
            return Response(content="No results yet", media_type="text/plain", status_code=202)
        
        # Find files with the exact name abritamr.tsv
        tsv_files = [obj['Key'] for obj in response['Contents'] if obj['Key'].split('/')[-1] == 'abritamr.tsv']
        
        if not tsv_files:
            logger.info(f"No abritamr.tsv files found for {run_id}")
            return Response(content="No results ready yet", media_type="text/plain", status_code=202)
        
        logger.info(f"Found results file(s): {tsv_files}")
        
        # Get the first result file found
        tsv_obj = s3.get_object(Bucket=bucket_name, Key=tsv_files[0])
        tsv_text = tsv_obj["Body"].read().decode('utf-8')
        
        return Response(content=tsv_text, media_type="text/plain")
    
    except Exception as e:
        logger.error(f"Error retrieving results for {run_id}: {e}")
        return Response(content=f"Unable to retrieve results, pipeline still running: {str(e)}", media_type="text/plain", status_code=500)
    
# Add this new endpoint for serving the MultiQC report
@app.get("/multiqc_report")
async def get_multiqc_report(run_id: str):
    """
    Download the MultiQC report from S3 and serve it to the frontend
    """
    logger.info(f"MultiQC report request for run_id: {run_id}")
    
    s3 = boto3.client('s3')
    bucket_name = "cloudresoutput"
    report_key = f"{run_id}/results/multiqc/multiqc_report.html"
    
    try:
        # Check if file exists first
        s3.head_object(Bucket=bucket_name, Key=report_key)
        
        # Download the file
        report_obj = s3.get_object(Bucket=bucket_name, Key=report_key)
        report_content = report_obj["Body"].read().decode('utf-8')
        
        # Serve the HTML content
        return Response(
            content=report_content, 
            media_type="text/html"
        )
    except Exception as e:
        logger.error(f"Error retrieving MultiQC report for {run_id}: {e}")
        return Response(
            content=f"MultiQC report not available yet. Please try again later.", 
            media_type="text/plain", 
            status_code=404
        )

@app.get("/nextflow_report")
async def get_nextflow_report(run_id: str):
    """
    Download the Nextflow execution report from S3 and serve it to the frontend
    """
    logger.info(f"Nextflow report request for run_id: {run_id}")
    
    s3 = boto3.client('s3')
    bucket_name = "cloudresoutput"
    
    # List all objects in the pipeline_info directory to find the execution report
    prefix = f"{run_id}/results/pipeline_info/"
    
    try:
        # List objects in the directory first
        logger.info(f"Looking for Nextflow reports in s3://{bucket_name}/{prefix}")
        response = s3.list_objects_v2(Bucket=bucket_name, Prefix=prefix)
        
        # Debug log the response
        if 'Contents' not in response:
            logger.warning(f"No files found in s3://{bucket_name}/{prefix}")
        else:
            logger.info(f"Found {len(response['Contents'])} files in pipeline_info directory")
            for obj in response.get('Contents', []):
                logger.info(f"Found file: {obj['Key']}")
        
        # Find the execution report file (they have timestamps in the name)
        execution_reports = [obj['Key'] for obj in response.get('Contents', []) 
                           if 'execution_report' in obj['Key'] and obj['Key'].endswith('.html')]
        
        if not execution_reports:
            logger.warning(f"No execution_report files found for {run_id}")
            return Response(
                content="Nextflow execution report not available yet.",
                media_type="text/plain",
                status_code=404
            )
        
        # Get the most recent report (usually there's only one)
        report_key = execution_reports[0]
        logger.info(f"Using report file: {report_key}")
        report_obj = s3.get_object(Bucket=bucket_name, Key=report_key)
        report_content = report_obj["Body"].read().decode('utf-8')
        
        return Response(
            content=report_content,
            media_type="text/html"
        )
    except Exception as e:
        logger.error(f"Error retrieving Nextflow report for {run_id}: {e}")
        return Response(
            content=f"Nextflow report not available yet. Please try again later.",
            media_type="text/plain",
            status_code=404
        )

@app.get('/api/download-test-data/{filename}')
async def download_test_file(filename: str):
    # Security validation
    if filename not in ['reads_R1.fastq.gz', 'reads_R2.fastq.gz']:
        raise HTTPException(status_code=400, detail="Invalid filename")
    
    # Use relative path - go up from app/main.py to the project root
    file_path = os.path.join(BASE_DIR, 'test_data', filename)
    
    logger.info(f"Attempting to serve test file: {file_path}")
    
    if not os.path.exists(file_path):
        logger.error(f"Test file not found: {file_path}")
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    
    return FileResponse(
        path=file_path,
        media_type='application/gzip',
        filename=filename
    )