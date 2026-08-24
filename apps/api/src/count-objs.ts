import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
const client = new S3Client({
  region: 'us-east-1', endpoint: 'http://127.0.0.1:9100', forcePathStyle: true,
  credentials: { accessKeyId: 'basaltkey', secretAccessKey: 'basaltsecret123' },
});
const r = await client.send(new ListObjectsV2Command({ Bucket: 'basalt-test' }));
console.log('objects:', r.KeyCount ?? 0);
for (const o of (r.Contents ?? []).slice(0, 3)) console.log('  ', o.Key, o.Size, 'bytes');
