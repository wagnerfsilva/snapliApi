#!/usr/bin/env bash
# =============================================================================
# setup-lambda.sh — Deploy + configure the snapli-image-processor Lambda
#
# Usage:
#   cd snapliApi/lambda
#   ../scripts/setup/setup-lambda.sh [--create | --update | --trigger | --all]
#
# Flags:
#   --create   Create the Lambda function (first time only)
#   --update   Update Lambda code + environment variables
#   --trigger  Configure the S3 trigger only
#   --all      Run create (if not exists) + trigger (default when no flag)
#
# Requirements:
#   - AWS CLI configured (aws configure)
#   - jq installed (brew install jq)
#   - Node.js 18+
#
# Environment variables required in .env (at snapliApi root):
#   AWS_REGION, AWS_ACCOUNT_ID,
#   S3_BUCKET_ORIGINAL, S3_BUCKET_WATERMARKED,
#   REKOGNITION_COLLECTION_ID, LAMBDA_EXECUTION_ROLE_ARN,
#   API_CALLBACK_URL, LAMBDA_INTERNAL_SECRET,
#   WATERMARK_TEXT, WATERMARK_OPACITY
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LAMBDA_DIR="$ROOT_DIR/lambda"
FUNCTION_NAME="snapli-image-processor"

# --- Load .env ---
if [ -f "$ROOT_DIR/.env" ]; then
    set -o allexport
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +o allexport
fi

# --- Validate required vars ---
require_var() {
    if [ -z "${!1:-}" ]; then
        echo "ERROR: $1 is not set. Add it to snapliApi/.env"
        exit 1
    fi
}

require_var AWS_REGION
require_var AWS_ACCOUNT_ID
require_var S3_BUCKET_ORIGINAL
require_var S3_BUCKET_WATERMARKED
require_var API_CALLBACK_URL
require_var LAMBDA_INTERNAL_SECRET

ROLE_ARN="${LAMBDA_EXECUTION_ROLE_ARN:-arn:aws:iam::${AWS_ACCOUNT_ID}:role/snapli-lambda-execution-role}"

# =============================================================================
# Step 1 — Build the deployment package with Linux-compatible sharp
# =============================================================================
build_package() {
    echo ""
    echo "==> Building Lambda package with Linux-compatible sharp..."
    cd "$LAMBDA_DIR"

    # Install sharp for Linux x64 (required even when developing on macOS/ARM)
    npm install --platform=linux --arch=x64 --libc=glibc --save sharp

    # Create zip (exclude local dev artifacts)
    rm -f function.zip
    zip -r function.zip . \
        --exclude "*.zip" \
        --exclude ".git/*" \
        --exclude "node_modules/.cache/*" \
        --exclude "test-event.json"

    echo "    Package ready: $LAMBDA_DIR/function.zip ($(du -sh function.zip | cut -f1))"
    cd "$ROOT_DIR"
}

# =============================================================================
# Step 2 — Create IAM role (if it doesn't exist)
# =============================================================================
create_iam_role() {
    echo ""
    echo "==> Checking IAM role: $ROLE_ARN"
    ROLE_NAME="snapli-lambda-execution-role"

    if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
        echo "    Role already exists — skipping"
        return
    fi

    echo "    Creating role $ROLE_NAME..."
    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": { "Service": "lambda.amazonaws.com" },
                "Action": "sts:AssumeRole"
            }]
        }' > /dev/null

    # Attach basic execution policy (CloudWatch Logs)
    aws iam attach-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

    # Inline policy for S3 + Rekognition
    aws iam put-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-name snapli-lambda-policy \
        --policy-document "{
            \"Version\": \"2012-10-17\",
            \"Statement\": [
                {
                    \"Effect\": \"Allow\",
                    \"Action\": [\"s3:GetObject\"],
                    \"Resource\": \"arn:aws:s3:::${S3_BUCKET_ORIGINAL}/*\"
                },
                {
                    \"Effect\": \"Allow\",
                    \"Action\": [\"s3:PutObject\", \"s3:PutObjectAcl\"],
                    \"Resource\": \"arn:aws:s3:::${S3_BUCKET_WATERMARKED}/*\"
                },
                {
                    \"Effect\": \"Allow\",
                    \"Action\": [
                        \"rekognition:DetectFaces\",
                        \"rekognition:IndexFaces\"
                    ],
                    \"Resource\": \"*\"
                }
            ]
        }"

    echo "    Role created. Waiting 10s for IAM propagation..."
    sleep 10
}

# =============================================================================
# Step 3 — Build env vars JSON for Lambda
# =============================================================================
lambda_env_vars() {
    cat <<EOF
{
    "AWS_REGION": "${AWS_REGION}",
    "S3_BUCKET_WATERMARKED": "${S3_BUCKET_WATERMARKED}",
    "REKOGNITION_COLLECTION_ID": "${REKOGNITION_COLLECTION_ID:-snapli-faces}",
    "WATERMARK_TEXT": "${WATERMARK_TEXT:-SNAPLI}",
    "WATERMARK_OPACITY": "${WATERMARK_OPACITY:-0.4}",
    "API_CALLBACK_URL": "${API_CALLBACK_URL}",
    "LAMBDA_INTERNAL_SECRET": "${LAMBDA_INTERNAL_SECRET}"
}
EOF
}

# =============================================================================
# Step 4a — Create Lambda function
# =============================================================================
create_function() {
    echo ""
    echo "==> Creating Lambda function: $FUNCTION_NAME"

    build_package
    create_iam_role

    ENV_VARS=$(lambda_env_vars | jq '{Variables: .}')

    aws lambda create-function \
        --function-name "$FUNCTION_NAME" \
        --runtime nodejs18.x \
        --role "$ROLE_ARN" \
        --handler index.handler \
        --zip-file "fileb://$LAMBDA_DIR/function.zip" \
        --timeout 300 \
        --memory-size 1024 \
        --environment "$ENV_VARS" \
        --description "Snapli image processor: watermark + thumbnail + Rekognition" \
        --region "$AWS_REGION"

    echo "    Lambda created successfully"
}

# =============================================================================
# Step 4b — Update Lambda code + env vars (for subsequent deploys)
# =============================================================================
update_function() {
    echo ""
    echo "==> Updating Lambda: $FUNCTION_NAME"

    build_package

    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file "fileb://$LAMBDA_DIR/function.zip" \
        --region "$AWS_REGION" > /dev/null

    echo "    Waiting for code update to finish..."
    aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$AWS_REGION"

    ENV_VARS=$(lambda_env_vars | jq '{Variables: .}')
    aws lambda update-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --environment "$ENV_VARS" \
        --region "$AWS_REGION" > /dev/null

    echo "    Lambda code + env vars updated"
}

# =============================================================================
# Step 5 — Configure S3 trigger (bucket notification)
# =============================================================================
configure_s3_trigger() {
    echo ""
    echo "==> Configuring S3 trigger: ${S3_BUCKET_ORIGINAL} → Lambda"

    LAMBDA_ARN="arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:${FUNCTION_NAME}"

    # Grant S3 permission to invoke Lambda
    aws lambda add-permission \
        --function-name "$FUNCTION_NAME" \
        --statement-id "s3-trigger-originals" \
        --action lambda:InvokeFunction \
        --principal s3.amazonaws.com \
        --source-arn "arn:aws:s3:::${S3_BUCKET_ORIGINAL}" \
        --source-account "$AWS_ACCOUNT_ID" \
        --region "$AWS_REGION" 2>/dev/null || echo "    Permission already exists — skipping"

    # Configure S3 bucket notification
    NOTIFICATION_CONFIG=$(cat <<EOF
{
    "LambdaFunctionConfigurations": [
        {
            "Id": "snapli-image-processor-trigger",
            "LambdaFunctionArn": "${LAMBDA_ARN}",
            "Events": ["s3:ObjectCreated:*"],
            "Filter": {
                "Key": {
                    "FilterRules": [
                        { "Name": "prefix", "Value": "events/" },
                        { "Name": "suffix", "Value": ".jpg" }
                    ]
                }
            }
        },
        {
            "Id": "snapli-image-processor-trigger-jpeg",
            "LambdaFunctionArn": "${LAMBDA_ARN}",
            "Events": ["s3:ObjectCreated:*"],
            "Filter": {
                "Key": {
                    "FilterRules": [
                        { "Name": "prefix", "Value": "events/" },
                        { "Name": "suffix", "Value": ".jpeg" }
                    ]
                }
            }
        },
        {
            "Id": "snapli-image-processor-trigger-png",
            "LambdaFunctionArn": "${LAMBDA_ARN}",
            "Events": ["s3:ObjectCreated:*"],
            "Filter": {
                "Key": {
                    "FilterRules": [
                        { "Name": "prefix", "Value": "events/" },
                        { "Name": "suffix", "Value": ".png" }
                    ]
                }
            }
        }
    ]
}
EOF
)

    echo "$NOTIFICATION_CONFIG" | aws s3api put-bucket-notification-configuration \
        --bucket "$S3_BUCKET_ORIGINAL" \
        --notification-configuration file:///dev/stdin

    echo "    S3 trigger configured on bucket: ${S3_BUCKET_ORIGINAL}"
    echo "    Filter: prefix=events/, suffix=.jpg/.jpeg/.png"
    echo "    Lambda ARN: ${LAMBDA_ARN}"
}

# =============================================================================
# Main
# =============================================================================
MODE="${1:---all}"

function_exists() {
    aws lambda get-function --function-name "$FUNCTION_NAME" --region "$AWS_REGION" >/dev/null 2>&1
}

case "$MODE" in
    --create)
        create_function
        ;;
    --update)
        update_function
        ;;
    --trigger)
        configure_s3_trigger
        ;;
    --all)
        if function_exists; then
            echo "Lambda $FUNCTION_NAME already exists — running update instead of create"
            update_function
        else
            create_function
        fi
        configure_s3_trigger
        ;;
    *)
        echo "Usage: $0 [--create | --update | --trigger | --all]"
        exit 1
        ;;
esac

echo ""
echo "==> Done. Monitor logs with:"
echo "    aws logs tail /aws/lambda/${FUNCTION_NAME} --follow --region ${AWS_REGION}"
