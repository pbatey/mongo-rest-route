import Ajv, { JSONSchemaType } from "ajv"
import addFormats from 'ajv-formats'

const requiredIdSchema = { type: "string" }
const optionalDateSchema = { type: "string", format: "date-time", nullable: true }

export interface DateFields {
  added?: string
  lastModified?: string
  deleted?: string
}

/** ensure the id is not required and the validator will be asynchronous (ie., throw errors) */
const withId = <T extends object>(schema:JSONSchemaType<T>) => {
  const newSchema = {...schema} as JSONSchemaType<T>
  newSchema.properties = {...newSchema.properties, _id: requiredIdSchema, $async: true}
  newSchema.required = [...newSchema.required.filter((x:string)=>x!='_id')]
  return newSchema
}

/** allow existing object, for PUT and PATCH, to have managed date fields */
const withManagedDates = <T extends object>(schema:JSONSchemaType<T>, dateFields:DateFields={}) => {
  const newSchema = {...schema} as JSONSchemaType<T>
  newSchema.properties = {...newSchema.properties}
  newSchema.properties[dateFields.added || 'added'] = optionalDateSchema
  newSchema.properties[dateFields.lastModified || 'lastModified'] = optionalDateSchema
  newSchema.properties[dateFields.deleted || 'deleted'] = optionalDateSchema
  return newSchema
}

interface Options {
  dateFields?: DateFields
}
export const getValidate = <T extends object>(schema:JSONSchemaType<T>, options:Options={}) => {
  const ajv = addFormats(new Ajv())
  const { dateFields:dateFieldOverrides } = options
  const dateFields = { added:'added', lastModified:'lastModified', deleted:'deleted', ...dateFieldOverrides}
  const idSchema = withId(schema)
  const dateSchema = withManagedDates(withId(schema), dateFields)

  /** Validate a payload against the schema provided to MongoRestRouter. Decodes the JSON payload if it is a string. */
  const validate = (payload:unknown, options?:{allowManagedDates:boolean}):T => {
    const { allowManagedDates: isUpdate=false } = options || {}
    if (isUpdate) {
      const p = payload as {[key:string]:any}
      delete p._id
      delete p[dateFields.added]
      delete p[dateFields.lastModified]
      delete p[dateFields.deleted]
    }
    ajv.validate(schema, payload)
    return payload as T
  }

  /** Validate a single object or an array */
  const validateBulk = (payload:unknown):(T[]) => {
    if (Array.isArray(payload)) {
      payload.forEach(x=>!validate(x)) // throws error if any are invalid
      return payload as T[]
    }
    validate(payload as T)
    return [payload as T]
  }
  return {validate, validateBulk}
}