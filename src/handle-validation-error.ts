import { ValidationError } from "ajv"
import { Response } from "express"

export { ValidationError }

/** Handles sending a 400 Bad Request response when catching a validation error. */
export const handleValidateError = (e:unknown, res:Response) => {
  if (e instanceof SyntaxError) {
    // probably a JSON.parse error
    return res.status(400).send({error: 'Invalid JSON payload', jsonParseError: e.message})
  }
  if (e instanceof ValidationError) {
    // at least one schema validation error encountered
    return res.status(400).send({error: 'Invalid payload', validationErrors: e.errors})
  }
  throw (e)
}

  