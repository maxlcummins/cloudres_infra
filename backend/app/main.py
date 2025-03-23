from fastapi import FastAPI, File, UploadFile, BackgroundTasks
from uuid import uuid4
from app.storage import upload_files_to_s3
from app.database import save_pipeline_run, get_pipeline_run_status
from fastapi.middleware.cors import CORSMiddleware
import boto3
import json
import base64  # Import base64

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

@app.post("/upload")
async def upload_fastq(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...)
):
    run_id = str(uuid4())
    s3_paths = upload_files_to_s3(run_id, files)
    save_pipeline_run(run_id, status="running", results=None)
    background_tasks.add_task(trigger_pipeline, run_id, s3_paths)
    return {"run_id": run_id, "status": "Pipeline started"}

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
        git clone -b dev https://github.com/maxlcummins/cloudres /home/ec2-user/cloudres/
        date

        echo "Preparing sample sheet for nextflow run..."
        SAMPLE_SHEET="/home/ec2-user/runs/${{run_id}}/samplesheet.csv"

        # Identify FASTQ files dynamically. Assumes filenames contain _R1 or _R2.
        fastq_r1=$(ls | grep -E "(_R1|_1)" | head -n 1)
        fastq_r2=$(ls | grep -E "(_R2|_2)" | head -n 1)

        # Extract sample name from the R1 filename.
        sample_name=$(basename "$fastq_r1" | sed 's/_R1.*//')

        echo "sample,fastq_1,fastq_2" > "$SAMPLE_SHEET"
        echo "${{sample_name}},/home/ec2-user/runs/${{run_id}}/${{fastq_r1}},/home/ec2-user/runs/${{run_id}}/${{fastq_r2}}" >> "$SAMPLE_SHEET"

        echo "Sample sheet created at: $SAMPLE_SHEET"

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

        print(f"User Data length: {len(user_data)}") #Added length print
        print(f"First 100 characters: {user_data[:100]}") #Added 100 char print
        encoded_user_data = base64.b64encode(user_data.encode('utf-8')).decode('utf-8') #Base64 encode.

        response = ec2.run_instances(
            LaunchTemplate={'LaunchTemplateId': 'lt-05c9e523b50df738d'},
            MinCount=1,
            MaxCount=1,
            UserData=encoded_user_data, #send encoded data
        )

        print(f"AWS EC2 API Response: {response}")
        instance_id = response['Instances'][0]['InstanceId']
        print(f"EC2 instance launched: {instance_id}")

    except Exception as e:
        print(f"Error launching EC2 instance: {e}")
