# SFTP Monitor

A lightweight GitHub Actions based monitor that connects to an SFTP server once per day and checks whether new content has been uploaded within the last 24 hours.

If no recent content is found, the workflow can trigger an alert or notification workflow.

## Features

- Daily automated monitoring using GitHub Actions
- Connects securely to SFTP
- Checks file timestamps against a configurable time window
- Lightweight Node.js implementation
- No dedicated server required
- Uses GitHub Secrets for credentials

## Workflow

The monitor runs automatically every day via GitHub Actions:

```yaml
schedule:
  - cron: '0 1 * * *'
