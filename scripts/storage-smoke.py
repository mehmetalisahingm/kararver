"""Exercise the two local S3 buckets; only this run's UUID objects are deleted."""
import uuid
import boto3
from botocore.config import Config
from urllib.request import urlopen
from urllib.error import HTTPError

s3 = boto3.client('s3', endpoint_url='http://127.0.0.1:8333',
    aws_access_key_id='kararver-local',
    aws_secret_access_key='kararver-local-only-not-a-secret',
    region_name='us-east-1', config=Config(signature_version='s3v4',
    connect_timeout=5, read_timeout=10, retries={'max_attempts': 4}))
for bucket in ('kararver-uploads-private', 'kararver-media-public'):
    key = 'smoke/' + str(uuid.uuid4()) + '.txt'
    s3.head_bucket(Bucket=bucket)
    try:
        s3.put_object(Bucket=bucket, Key=key, Body=b'kararver-smoke')
        assert s3.get_object(Bucket=bucket, Key=key)['Body'].read() == b'kararver-smoke'
        if bucket.endswith('private'):
            try:
                with urlopen(f'http://127.0.0.1:8333/{bucket}/{key}', timeout=10) as response:
                    raise AssertionError(f'Private object is anonymous-readable: {response.status}')
            except HTTPError as error:
                assert error.code in (401, 403), error.code
        print(f'{bucket}: signed write/read OK')
    finally:
        s3.delete_object(Bucket=bucket, Key=key)
print('Storage smoke passed; public delivery policy remains a KV-16 implementation task.')
