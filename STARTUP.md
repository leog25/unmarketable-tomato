# Real-Time Captions - Startup Guide with gcloud CLI

## Overview
Real-time speech-to-text captions application using Google Cloud Speech API. This guide uses gcloud CLI for setup and configuration.

## Prerequisites
- Node.js (v14 or higher)
- npm package manager
- Google Cloud SDK (gcloud CLI)

## Setup Steps

### 1. Install Google Cloud SDK
```bash
# Download and install from: https://cloud.google.com/sdk/docs/install
# Or use package managers:

# Windows (using Chocolatey)
choco install gcloudsdk

# macOS (using Homebrew)
brew install google-cloud-sdk

# Linux
curl https://sdk.cloud.google.com | bash
```

### 2. Initialize gcloud and authenticate
```bash
# Initialize gcloud
gcloud init

# Login to your Google account
gcloud auth login

# Set application default credentials
gcloud auth application-default login
```

### 3. Create and configure a Google Cloud project
```bash
# Create a new project (or use existing)
gcloud projects create my-caption-project --name="Caption Project"

# Set the project as default
gcloud config set project my-caption-project

# Enable billing (required for Speech API)
# Visit: https://console.cloud.google.com/billing
```

### 4. Enable Speech-to-Text API
```bash
# Enable the Speech-to-Text API
gcloud services enable speech.googleapis.com

# Verify it's enabled
gcloud services list --enabled | grep speech
```

### 5. Create service account (optional, for production)
```bash
# Create service account
gcloud iam service-accounts create caption-service \
    --display-name="Caption Service Account"

# Generate key file
gcloud iam service-accounts keys create credentials.json \
    --iam-account=caption-service@my-caption-project.iam.gserviceaccount.com

# Grant necessary permissions
gcloud projects add-iam-policy-binding my-caption-project \
    --member="serviceAccount:caption-service@my-caption-project.iam.gserviceaccount.com" \
    --role="roles/speech.client"
```

### 6. Install application dependencies
```bash
# Navigate to project directory
cd unmarketable-tomato

# Install npm packages
npm install
```

### 7. Configure environment
```bash
# For development (using default application credentials)
# No additional config needed if you ran 'gcloud auth application-default login'

# For production (using service account)
# Windows
set GOOGLE_APPLICATION_CREDENTIALS=path\to\credentials.json

# Linux/macOS
export GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json
```

## Running the Application

### Development
```bash
# Uses application default credentials
npm run dev
```

### Production
```bash
# Ensure credentials are set
npm start
```

## Verify Setup

### Check gcloud configuration
```bash
# View current configuration
gcloud config list

# Check authenticated accounts
gcloud auth list

# Verify project
gcloud config get-value project

# Test Speech API access
gcloud ml speech recognize --content-type=audio/l16 \
    --encoding=LINEAR16 --sample-rate=16000 \
    --language-code=en-US --include-word-confidence
```

## Common gcloud Commands

```bash
# Switch between projects
gcloud config set project PROJECT_ID

# View API quotas
gcloud compute project-info describe --project=PROJECT_ID

# Monitor API usage
gcloud logging read "resource.type=speech.googleapis.com"

# List available regions
gcloud compute regions list

# Check billing status
gcloud billing accounts list
```

## Troubleshooting

### Authentication Issues
```bash
# Refresh credentials
gcloud auth application-default login

# Revoke and re-authenticate
gcloud auth revoke
gcloud auth login
```

### API Not Enabled
```bash
# List all available APIs
gcloud services list --available | grep speech

# Enable if not active
gcloud services enable speech.googleapis.com
```

### Quota or Billing Issues
```bash
# Check quota
gcloud compute project-info describe

# Link billing account
gcloud billing projects link PROJECT_ID \
    --billing-account=BILLING_ACCOUNT_ID
```

## Build for Distribution
```bash
npm run build
```

## Additional Resources
- [gcloud CLI Reference](https://cloud.google.com/sdk/gcloud/reference)
- [Speech-to-Text API Documentation](https://cloud.google.com/speech-to-text/docs)
- [gcloud Auth Guide](https://cloud.google.com/sdk/docs/authorizing)