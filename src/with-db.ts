import { NextFunction, Request, Response } from "express"
import { Db, MongoClient, MongoError, MongoServerError } from "mongodb"

const clients:{[key:string]:MongoClient|undefined} = {}
const resolveDb = (db?:Db|(()=>Db)|string):Db => {
  if (typeof db == 'function') return db()
  if (db === undefined) db = process.env.MONGO_URL
  if (typeof db == 'string') {
    const client = clients[db] || new MongoClient(db)
    clients[db] = client
    return client.db()
  }
  if (db === undefined) {
    throw new Error('The withDb() function was called w/o a db. Try setting MONGO_URL.')
  }
  return db
}

// Note: typescript requires ./types/index.d.ts to exist so db shows up on express.Request

/**
 * Middleware to add db instance to the Request. Uses env var MONGO_URL to define connection.
 * 
 * @example
 * app.get('/api/v1/users', async (req:Request, res:Response) => {
 *   res.send(await req.locals.db.collection('users').find({}).toArray())
 * })
 */
export const withDb = (db?:Db|(()=>Db)|string) => (req: Request, res: Response, next?: NextFunction) => {
  const mongoURL = process.env.MONGO_URL
  if (!mongoURL) throw new Error("MONGO_URL not set")

  try {
    req.locals.db = resolveDb(db)
  } catch (e) {
    if (e instanceof MongoError) {
      // reset connection if MongoServerError or MongoError
      console.warn('Unexpected error connecting to db. Resetting the connection.', e)
      clients[mongoURL]?.close()
      clients[mongoURL] = undefined
    }
    if (e instanceof MongoServerError) {
      res.status(503).send({error: 'Mongo server is overloaded.'})
      return
    }
    if (e instanceof MongoError) {
      res.status(500).send({error: 'Unexpected Mongo error.'})
      return
    }
    console.error('Unexpected error connecting to db.', e)
    res.status(500).send({error: 'Unexpected error.'})
  }
  if (next) next()
}