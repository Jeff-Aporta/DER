export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/** Error de verificación (lo que retorna un pre*). HTTP 400. */
export class ValidationError extends HttpError {
  constructor(message: string) {
    super(400, message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "No encontrado") {
    super(404, message);
    this.name = "NotFoundError";
  }
}
