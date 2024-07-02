import { ValidationError } from "./handle-validation-error"
import jsonPatchSchema from './json-patch-schema'
import Ajv, { ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import { ObjectId } from "mongodb"
import { Request } from "express"
import { applyPatch } from 'fast-json-patch'

const ajv = addFormats(new Ajv())
const validatePatchSchema = ajv.compile(jsonPatchSchema)

interface PatchTarget { [key:string]: any, _id: ObjectId }

const getPatchTarget = (o:PatchTarget, keys:string|string[]):PatchTarget|undefined => {
  if (o === undefined) return undefined
  if (!Array.isArray(keys)) {
    keys = keys.split('/').filter(x=>!!x).map(x=>x.replace('~0', '/').replace('~1', '~'))
  }
  if (keys.length > 1) {
    if (Array.isArray(o)) {
      const index = parseInt(keys[0])
      return getPatchTarget(o[index], keys.slice(1))
    }
    return getPatchTarget(o[keys[0]], keys.slice(1))
  }
  // if target is a primitive, then the last key can't be applied to it
  if (['number', 'bigint', 'string', 'boolean'].includes(typeof o)) return undefined
  return o
}

interface HasId { [key:string]: any, _id: ObjectId }
/**
 * Applies a PATCH request to an Mongo document.
 * 
 * @param origObject An object with an `_id` field to verify the patch doesn't modify it
 * @param req An express Request object with a query and body
 * @returns the patch result
 * @throws ValidationError if the body is not a JSONPatch object, or the _id value is modified.
 */
export const applyPatchRequest = (origObject:HasId, req:Request) => {
  let newObject:HasId = { _id: new ObjectId() }
  const isBodyEmpty = !Object.keys(req.body).length
  if (isBodyEmpty) {
    // patch using query params
    newObject = {...origObject}
    Object.keys(req.query).filter(x=>!!x).forEach((key)=>{
      const target = getPatchTarget(newObject, key)
      const value = req.query[key]?.toString()

      if (target === undefined || value === undefined) return

      const literals = [
        ['undefined', undefined],
        ['null', null],
        ['true', true],
        ['false', false],
      ]
      const l = literals.find(([x])=>value==x)
      if (l != undefined) {
        target[key] = l[1]
        return
      }
      // quoted string
      if (value[0] == '"' && value[0] == value[value.length-1]) {
        target[key] = value.slice(1, value.length-2)
        return
      }
      // number
      const n = parseFloat(value)
      if (n < Infinity && n > -Infinity) {
        target[key] = n
        return
      }
      // date-time
      const d = new Date(value)
      if (!isNaN(d.getTime())) {
        target[key] = d
      }
      // otherwise as-is string
      target[key] = value
    })
  } else {
    // JSON Patch
    const patch = JSON.parse(req.body)
    validatePatchSchema(req.body) // might throw ValidationError
    newObject = applyPatch(origObject, patch).newDocument
  }

  if (origObject._id.toHexString() != newObject._id.toHexString()) {
    const e:ErrorObject = {
      keyword: "",
      instancePath: "/_id",
      schemaPath: "",
      params: [],
      message: 'The _id field is read only.'
    }
    throw new ValidationError([e])
  }
  return newObject
}