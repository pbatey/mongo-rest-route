import { Request, Response, Router, RouterOptions, json } from 'express'
import { JSONSchemaType, ErrorObject } from 'ajv'
import q2m from 'query-to-mongo'
import { Db, FindOptions, MongoClient, ObjectId } from 'mongodb'
import { ValidationError, handleValidateError } from './handle-validation-error'
import { withDb } from './with-db'
import { applyPatchRequest } from './apply-patch-request'
import { getValidate } from './get-validate'

interface DateFields {
  added?: string
  lastModified?: string
  deleted?: string
}

const NotFoundMessage = 'An entry with that id could not be found.'

const idPath = '/:id([0-9a-fA-F]{24})' // 24-hex-digits

type DbResolver = ()=>Db
export interface MongoRestRouterOptions extends RouterOptions {
  db?: Db | DbResolver | string
  /** A list of methods to provide. Provide all if unset. */
  methods?: ('GET'|'POST'|'PUT'|'PATCH'|'DELETE')[],
  sort?: object,
  noGetSearch?: boolean
  noPostBulk?: boolean
  resultsField?: string
  noArchive?: boolean
  noManagedDates?: boolean
  dateFields?: DateFields
}

/**
 * A function to expose a Mongo Collection as a REST API.
 * - GET '/' - returns an object with `count` and results of search in a field named the same as the collection.
 * - GET '/:id'
 * - POST '/' - return either `insertedId` or a list of ids as `insertedIds`, if an array is posted
 * - PUT '/:id'
 * - PATCH '/:id' - expects a JSON Patch definition
 * - DELETE '/:id'
 * 
 * @param {string} collection name of collection
 * @param {JSONSchemaType} schema a JSON Schema definition
 * @param {(Db|DbResolver)} options.db Mongo database. Uses req.locals.db if unset.
 * @param {('GET'|'POST'|'PUT'|'PATCH'|'DELETE')[]} options.methods List of methods to provide. Provides all if unset.
 * @param {object} options.sort the sorting to unless overridden by query parameters
 * @param {boolean} options.noGetSearch Do not provide the GET '/' route for searching.
 * @param {boolean} options.noPostBulk Do not allow an array to be provided to the POST method.
 * @param {string} options.resultsField Use this instead of the collection name as the search results field.
 * @param {boolean} options.noArchive Don't set the deleted property upon first DELETE. Remove immediately.
 * @param {boolean} options.noManagedDates Don't set date tracking fields: added, lastModified, or deleted.
 * @param {string} options.dateFields.added Use this instead of 'added' for tracking POST operations.
 * @param {string} options.dateFields.lastModified Use this instead of 'lastModified' for tracking last PUT and PATCH operations.
 * @param {string} options.dateFields.deleted Use this instead of 'deleted' for tracking DELETE operations.
 * 
 * @returns {Router} an express router that exposes the collection via a REST API.
 * 
 * @example
 * const BookSchema = {type: "object", properties { title: { type: "string", ...}}}
 * const booksAPI = MongRestRouter('books', BookSchema)
 * const app = express()
 * app.use('/api/v1/books', booksAPI)
 */
export const MongoRestRouter = <T extends object>(collection:string, schema:JSONSchemaType<T>, options={} as MongoRestRouterOptions): Router => {
  const { db, methods, sort, noGetSearch: noSearch, noPostBulk, resultsField, noArchive, noManagedDates, dateFields:dateFieldOverrides } = options
  const dateFields = { added:'added', lastModified:'lastModified', deleted:'deleted', ...dateFieldOverrides}
  const router = Router(options)
  router.use(json()) // body will be an object
  router.use(withDb(db))

  const {validate, validateBulk} = getValidate(schema, {dateFields})

  if (!methods || methods.includes('GET')) {
    /* ----------------------------------------
     * GET / - retrieve a list of entries by search criteria
     * ----------------------------------------*/
    if (!noSearch) {
      router.get('/', async (req:Request, res:Response)=>{
        const c = req.locals.db.collection(collection)
        const { criteria, options } = q2m(req.query)
        options.sort = options.sort || sort
        if (!noManagedDates) {
          (criteria as {[key:string]:any})[dateFields.deleted] = { "$exists" : false }
        }
        const result = {} as any
        result.count = await c.countDocuments(criteria)
        result[resultsField || collection] = await c.find(criteria, options as FindOptions).toArray()
        return res.send(result)
      })
    }

    /* ----------------------------------------
     * GET /:id - retrieve an entry
     * ----------------------------------------*/
    router.get(idPath, async (req:Request, res:Response)=>{
      const c = req.locals.db.collection(collection)
      const criteria = {'_id': new ObjectId(req.params.id)}
      if (!noManagedDates) {
        (criteria as {[key:string]:any})[dateFields.deleted] = { "$exists" : false }
      }
      const found = await c.findOne(criteria)
      if (!found) {
        res.status(404).send({error: NotFoundMessage})
        return
      }
      res.send(found)
    })

    if (!noArchive || noManagedDates) {
      /* ----------------------------------------
       * GET /archive - retrieve a list of deleted entries by search criteria
       * ----------------------------------------*/
      router.get(`/archive`, async (req:Request, res:Response)=>{
        const c = req.locals.db.collection(collection)
        const { criteria, options } = q2m(req.query)
        ;(criteria as {[key:string]:any})[dateFields.deleted] = { "$exists" : true }
        const result = {} as any
        result.count = await c.countDocuments(criteria)
        result[resultsField || collection] = await c.find(criteria, options as FindOptions).toArray()
        return res.send(result)
      })

      /* ----------------------------------------
       * GET /archive/:id - retrieve a deleted entry
       * ----------------------------------------*/
      router.get(`/archive/${idPath}`, async (req:Request, res:Response)=>{
        const c = req.locals.db.collection(collection)
        const criteria = {'_id': new ObjectId(req.params.id)}
        ;(criteria as {[key:string]:any})[dateFields.deleted] = { "$exists" : true }
        const found = await c.findOne(criteria)
        if (!found) {
          res.status(404).send({error: NotFoundMessage})
          return
        }
        res.send(found)
      })
    }
  }

  if (!methods || methods.includes('POST')) {
    /* ----------------------------------------
     * POST / - store an entry or bulk store many entries
     * ----------------------------------------*/
    router.post('/', async (req:Request, res:Response)=>{
      try {
        const payload = validateBulk(req.body)
        const c = req.locals.db.collection(collection)
        if (Array.isArray(payload)) {
          if (noPostBulk) {
            const e:ErrorObject = {
              keyword: '',
              instancePath: '',
              schemaPath: '',
              params: [],
              message: 'Expecting an object'
            }
            throw new ValidationError([e])
          }
          if (!noManagedDates) {
            const now = new Date()
            payload.forEach((x:{[key:string]:any}) => {
              x[dateFields.added] = now
            })
          }
          const result = await c.insertMany(payload)
          res.send({insertedIds: result.insertedIds})
          return
        }

        if (!noManagedDates) {
          (payload as {[key:string]:any})[dateFields.added] = new Date()
        }
        const result = await c.insertOne(payload)
        res.send({insertedId: result.insertedId})
      } catch (e) {
        handleValidateError(e, res)
      }
    })
  }

  if (!methods || methods.includes('PUT')) {
    /* ----------------------------------------
     * PUT /:id - update an entry
     * ----------------------------------------*/
    router.put(idPath, async (req:Request, res:Response)=>{
      try {
        const payload = validate(req.body, {allowManagedDates:true}) as {_id?:ObjectId}
        payload._id = new ObjectId(req.params.id)
        if (!noManagedDates) {
          const p = payload as {[key:string]:any}
          p[dateFields.added] = undefined // do not update
          p[dateFields.lastModified] = new Date()
        }
        const c = req.locals.db.collection(collection)
        const criteria = {'_id': payload._id}
        if (!noManagedDates) {
          (criteria as {[key:string]:any})[dateFields.deleted] = { "$exists" : false }
        }
        const result = await c.updateOne(criteria, payload)
        if (result.modifiedCount == 0) {
          res.status(404).send({error: NotFoundMessage})
          return
        }
        res.send({modifiedCount: result.modifiedCount})
      } catch (e) {
        handleValidateError(e, res)
      }
    })
  }

  if (!methods || methods.includes('PATCH')) {
    /* ----------------------------------------
     * PATCH /:id - update individual fields in an entry
     * ----------------------------------------*/
    router.patch(idPath, async (req:Request, res:Response)=>{
      const c = req.locals.db.collection(collection)
      const criteria = {'_id': new ObjectId(req.params.id)}
      if (!noManagedDates) {
        (criteria as {[key:string]:any})[dateFields.deleted] = { "$exists" : false }
      }
      const origObject = await c.findOne(criteria)
      if (!origObject) {
        res.status(404).send({error: NotFoundMessage})
        return
      }

      try {
        const newObject = applyPatchRequest(origObject, req)
        console.log('PATCH newObject', newObject)
        validate(newObject, {allowManagedDates:true})
        if (!noManagedDates) {
          (newObject as {[key:string]:any})[dateFields.lastModified] = new Date()
        }
        const result = await c.updateOne({'_id': origObject._id}, { $set: newObject })
        res.send({modifiedCount: result.matchedCount})
      } catch (e) {
        handleValidateError(e, res)
        return
      }
    })
  }

  if (!methods || methods.includes('DELETE')) {
    /* ----------------------------------------
     * DELETE /:id - update an entry
     * ----------------------------------------*/
    router.delete(idPath, async (req:Request, res:Response)=>{
      const c = req.locals.db.collection(collection)
      if (noArchive || noManagedDates) {
        const result = await c.deleteOne({"_id": new ObjectId(req.params.id)})
        res.status(200).send({deletedCount: result.deletedCount})
        return
      }

      // set deleted field
      const criteria = {'_id': new ObjectId(req.params.id)}
      if (!noManagedDates) {
        (criteria as {[key:string]:any})[dateFields.deleted] = { "$exists" : false }
      }
      const updates:{[key:string]:any} = {}
      updates[dateFields.deleted] = new Date()
      const result = await c.updateOne(criteria, { "$set": updates })
      res.status(200).send({deletedCount: result.modifiedCount})
    })

    if (!noArchive || noManagedDates) {
      router.delete(`/archive/${idPath}`, async (_req:Request, res:Response)=>{
       // TODO: implement delete from archive
        res.status(501).send({error: 'Archive not yet implemented'})
      })
    }
  }

  return router
}