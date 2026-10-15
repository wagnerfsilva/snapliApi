# Video Lambda

This function processes MOV/MP4 originals from S3, independently of the existing
`snapli-image-processor` photo Lambda. There is no video worker inside the API.
The container uses the official AWS Node.js 22 runtime and isolated FFmpeg
libraries. Build only for `linux/amd64`; the bundled loader requires x86_64.

The handler validates media, creates a marked poster and MP4 preview, indexes
one unmarked frame every 10 seconds in the existing Rekognition collection, and
persists results through authenticated API callbacks. Originals are not replaced
with previews. Existing completed videos are not reprocessed during rollout.

## Build

From the API repository root:

```sh
npm audit --prefix lambda/video --omit=dev
docker buildx build --platform linux/amd64 --provenance=false --load \
  -f lambda/video/Dockerfile -t snapli-video-processor:local .
```

The Dockerfile-specific ignore file excludes credentials, backups and unrelated
source files. The image contains the shared preparation service, not the API or
database credentials.

## Deployment Permissions

Deployment requires the permissions below on `fotow-app-user`. An AWS
administrator must authorize deployment before publishing; do not disable the
production worker before its replacement exists. Do not grant these deployment
privileges to the Lambda execution role.

An administrator can create a customer-managed IAM policy named
`SnapliVideoDeploy` using [deploy-policy.json](deploy-policy.json), then attach
it to `fotow-app-user`. Do not use an inline user policy: the document exceeds
the 2048-character aggregate inline user limit. It also permits inspecting
the existing execution role and reading video logs for deployment validation;
it does not permit changing IAM policies or modifying the photo function.

The deployment principal needs these actions, with resource scopes as listed:

| Actions | Resource |
| --- | --- |
| `ecr:GetAuthorizationToken` | `*` |
| `ecr:CreateRepository`, `ecr:DescribeRepositories`, `ecr:DescribeImages`, `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `ecr:GetRepositoryPolicy`, `ecr:SetRepositoryPolicy` | `arn:aws:ecr:us-east-1:866043232856:repository/snapli-video-processor` |
| `lambda:CreateFunction`, `lambda:UpdateFunctionCode`, `lambda:UpdateFunctionConfiguration`, `lambda:AddPermission`, `lambda:GetPolicy`, `lambda:GetFunction` | `arn:aws:lambda:us-east-1:866043232856:function:snapli-video-processor` |
| `lambda:GetFunction` | `arn:aws:lambda:us-east-1:866043232856:function:snapli-image-processor` |
| `iam:PassRole` with `iam:PassedToService=lambda.amazonaws.com` | `arn:aws:iam::866043232856:role/snapli-lambda-execution-role` |
| `s3:GetBucketNotification`, `s3:PutBucketNotification` | Original S3 bucket ARN |

The execution role must permit reading originals, writing marked outputs,
`rekognition:IndexFaces` on the existing collection, and CloudWatch logging.
The ECR repository must allow `lambda.amazonaws.com` to perform
`ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer`; preserve existing repository
policy statements when adding that permission.

## Rollout Order

1. Build and push the image to `snapli-video-processor` in ECR, region `us-east-1`.
2. Create `snapli-video-processor` as an image Lambda, x86_64, using the existing
   photo execution role after checking its S3/Rekognition permissions. Configure
   4096 MiB memory, 4096 MiB temporary storage and timeout 900 seconds. These are
   initial settings, not a performance certification for maximum-size videos.
3. Set the following function environment variables privately in AWS:
   `API_CALLBACK_URL=https://snapliapi-production.up.railway.app/api/videos/lambda-callback`,
   `LAMBDA_INTERNAL_SECRET` matching the API, `S3_BUCKET_ORIGINAL`,
   `S3_BUCKET_WATERMARKED`, and `REKOGNITION_COLLECTION_ID` matching the API.
   Do not set reserved `AWS_REGION` or application AWS access keys: the function
   uses its execution role and AWS-provided region.
4. Grant the original bucket permission to invoke the video Lambda, with
   `s3.amazonaws.com`, the exact bucket SourceArn and account SourceAccount.
5. Verify the function is Active and the image starts successfully. Prepare two
   S3 `ObjectCreated:*` notifications, prefix `events/`, suffixes `.mov` and
   `.mp4`, targeting the video Lambda. **Preserve all three existing photo
   notifications and any queue, topic or EventBridge configuration.** Setting a
   bucket notification replaces the whole configuration, not just added rules.
6. Pause video uploads and wait for any active processing to finish. Deploy the
   API callbacks and worker removal,
   then activate the video S3 notifications and set `VIDEO_LAMBDA_ENABLED=true`
   in Railway. Do not upload between these steps. Confirm `/api/health` reports
   `video.processor=lambda` and `video.ready=true`. Readiness alone does not
   prove the function or triggers are healthy.
7. The user performs the next real upload and checks completion, selfie search
   and paid original downloads. Do not reprocess their existing completed video
   or perform a purchase on their behalf.

Lambda asynchronous failures use AWS retries. Callbacks reject early S3 events
until multipart upload confirmation. A transactional 15-minute claim protects
against duplicate processing, and completed callbacks increment the event's
video counter only once. Manual retry copies an original onto its unchanged key
to generate another S3 event; it does not invoke a recurring worker or queue.