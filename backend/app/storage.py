import boto3
import os
from fastapi import UploadFile


S3_BUCKET = os.getenv("S3_BUCKET_NAME", "cloudresinput")

def upload_files_to_s3(run_id: str, files: list[UploadFile]):
    s3 = boto3.client('s3')
    s3_paths = []
    
    for file in files:
        key = f"{run_id}/{file.filename}"
        s3.upload_fileobj(file.file, S3_BUCKET, key)
        s3_paths.append(f"s3://{S3_BUCKET}/{key}")

    return s3_paths