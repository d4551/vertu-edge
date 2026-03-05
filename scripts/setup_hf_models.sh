#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${VERTU_HF_CLIENT_ID:-}" ]]; then
  echo "VERTU_HF_CLIENT_ID is not set"
  exit 1
fi

if [[ -z "${VERTU_HF_REDIRECT_URI:-}" ]]; then
  echo "VERTU_HF_REDIRECT_URI is not set"
  exit 1
fi

echo "Hugging Face OAuth environment looks configured for Vertu Edge"
echo "VERTU_HF_CLIENT_ID=${VERTU_HF_CLIENT_ID}"
echo "VERTU_HF_REDIRECT_URI=${VERTU_HF_REDIRECT_URI}"
