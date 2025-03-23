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

        ec2 = boto3.client('ec2')

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
        echo "run_id: $run_id"

        echo "Creating run_id directory..."
        sudo mkdir -p /home/ec2-user/runs/$run_id
        date

        echo "Changing directory to run directory..."
        cd /home/ec2-user/runs/$run_id
        date

        echo "Copying data from S3..."
        for s3_path in $(jq -r '.s3_paths[]' /home/ec2-user/runs/params.json); do
        aws s3 cp "$s3_path" .
        done
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

        echo "Cloning nextflow repo..."
        mkdir -p /home/ec2-user/MonkeyPoxWebApp/
        git clone https://github.com/maxlcummins/MonkeyPoxWebApp /home/ec2-user/MonkeyPoxWebApp/
        date

        echo "Running nextflow..."
        nextflow run /home/ec2-user/MonkeyPoxWebApp/pipeline/main.nf -input_dir /home/ec2-user/runs/$run_id -work-dir work
        date

        echo "Uploading results..."
        aws s3 sync /home/ec2-user/runs/$run_id/work/results/ s3://mpoxoutput/$run_id/results/
        date

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
