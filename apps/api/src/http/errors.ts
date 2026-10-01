// Sözleşme hata formatı: {error: {code, message, details}, requestId} (API_CONTRACTS.md §5).
// İstemciye SQL, stack, parola, session veya token gitmez; beklenmeyen hata 500 INTERNAL_ERROR olur.
import { errorResponse, errorStatuses, type ErrorCode } from "@kararver/contracts";
import type { FastifyError, FastifyInstance } from "fastify";
import type { z } from "zod";

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown[];
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, message: string, details: unknown[] = [], headers: Record<string, string> = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.headers = headers;
  }

  get status(): number {
    return errorStatuses[this.code];
  }
}

export function validationError(error: z.ZodError, location: "body" | "query" | "params"): ApiError {
  const details = error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : location,
    code: issue.code,
    message: issue.message,
  }));
  return new ApiError("VALIDATION_ERROR", "İstek geçersiz.", details);
}

/** Fastify'ın kendi ürettiği istemci hataları (bozuk JSON, desteklenmeyen içerik türü, büyük gövde). */
function isClientFastifyError(error: FastifyError): boolean {
  return typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500;
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) {
      reply.headers(error.headers);
      return reply.status(error.status).send(errorResponse(error.code, error.message, request.id, error.details));
    }
    if (isClientFastifyError(error)) {
      const details = [{ field: "body", code: error.code ?? "invalid_request" }];
      return reply.status(400).send(errorResponse("VALIDATION_ERROR", "İstek geçersiz.", request.id, details));
    }
    request.log.error({ err: error }, "beklenmeyen hata");
    return reply.status(500).send(errorResponse("INTERNAL_ERROR", "Beklenmeyen bir hata oluştu.", request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(errorResponse("NOT_FOUND", "İstenen adres bulunamadı.", request.id));
  });
}
