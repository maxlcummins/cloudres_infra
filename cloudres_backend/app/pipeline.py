# pipeline.py
import boto3
import os

def trigger_pipeline(run_id: str, s3_paths: list[str]):
    batch = boto3.client('batch')

    response = batch.submit_job(
        jobName=f"pipeline-{run_id}",
        jobQueue=os.getenv("AWS_BATCH_QUEUE", "nextflow-job-queue"),
        jobDefinition=os.getenv("AWS_BATCH_JOB_DEF", "nextflow-job-def"),
        containerOverrides={
            "command": [
                "nextflow", "run", "main.nf",
                "--fastq_paths", ','.join(s3_paths),
                "-profile", "awsbatch"
            ]
        }
    )
    print("Pipeline job submitted:", response["jobId"])
