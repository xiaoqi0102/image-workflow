export class ImageWorkflowError extends Error {
  constructor(message, code = "IMAGE_WORKFLOW_ERROR", options = {}) {
    super(message, options);
    this.name = "ImageWorkflowError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.cause = options.cause;
  }
}

export function asImageWorkflowError(error, fallback = "请求失败") {
  if (error instanceof ImageWorkflowError) return error;
  return new ImageWorkflowError(error?.message || String(error), "REQUEST_FAILED", { cause: error });
}
