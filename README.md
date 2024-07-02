# Mongo REST Router

Creates an Express route that exposes a Mongo collection via a REST API.

Here's the list of api methods exposed by the route:

- **GET /api/v1/:collection** - List documents. Uses [query-to-mongo]{https://www.npmjs.com/package/query-to-mongo} to turn query parameters into search criteria.
- **GET /api/v1/:collection/:id** - Retrieve a document.
- **POST /api/v1/:collection** - Store a new document or bulk store a list of document. Response includes **insertedId** or **insertedIds** respectively.
- **PUT /api/v1/:collection/:id** - Update a document.
- **PATCH /api/v1/:collection/:id** - Update parts of a document using [JSON Patch][jp] or query parameters.
- **DELETE /api/v1/:collection/:id** - Delete a document. Set's the deleted property, moving it to the archive, unless the **noArchive** option is set `true`.

[jp]: https://jsonpatch.com/

The following _archive_ related routes are added unless **noArchive** is set `true`. Deleted documents are put in the archive (marked with a `deleted` field), not deleted immediately.

- **GET /api/v1/:collection/archive** - List archived documents. Uses [query-to-mongo]{https://www.npmjs.com/package/query-to-mongo} to turn query parameters into search criteria.
- **GET /api/v1/:collection/archive/:id** - Retrieve an archived documents.
- **PATCH /api/v1/:collection/archive/:id** - Modify an archived documents. Useful for removing the deletedOn property, restoring the document.
- **DELETE /api/v1/:collection/archive/:id** - Delete a document permanently.


## An example

The following let's you expose a mongo collection **members** as a REST API.

1. Ensure the `MONGO_URL` is set as an env var (that's what the `withDb` middleware uses). For example: `mongodb://user:pass@localhost:27017/db`.

   An alternative is to call **MongoRestRoute** with an **options.db** defined.

2. define a schema using JSON Schema syntax:

   **members.ts**
   ```javascript
   export interface Member {
     _id: string
     name: string
     email: string
     address?: string
     phone?: string
   }
   
   export const memberSchema:JSONSchemaType<Member> = {
     type: 'object',
     properties: {
       _id: {type: 'string'},
       name: {type: 'string'},
       email: {type: 'string', format: 'email'},
       address: {type: 'string', nullable: true},
       phone: {type: 'string', nullable: true},
     },
     required: ['_id', 'name', 'email'],
     additionalProperties: false,
   }
   ```

3. Add the route to the express app

   **routes.ts**
   ```javascript
   import express from 'express'
   import { MongoRestRoute, withDb } from 'mongo-rest-router'
   import { membersSchema } from './members.ts'
   
   const app = express()
   app.use('/api/v1/members', withDb, MongoRestRouter('members', membersSchema))
   
   const port = 3000
   app.listen(port, () => {
     console.info(`Example app listening on port ${port}`)
   })
   ```

## API

### MongoRestRouter

**Parameters**
- **collection** `string` name of collection
- **schema** `JSONSchemaType` a JSON Schema definition
- **options.db** `mongodb.Db` (Optional) Mongo database, a function to return one, or a mongo connection string. Uses `process.env.MONGO_URL` if unset.
- **options.methods** `string[]` (Optional) List of methods to provide. List can include any of: `'GET'`, `'POST'`, `'PUT'`, `'PATCH'`, and `'DELETE'`. Provides all if unset.
- **options.noGetSearch** `boolean` (Optional) Do not provide the GET / route for searching.
- **options.noPostBulk** `boolean` (Optional) Do not allow an array to be provided to the POST method.
- **options.resultsField** `string` (Optional) Use this instead of the collection name as the search result field.
- **options.noArchive** `boolean` (Optional) Don't set the deletedOn property upon DELETE, remove it immediately.
- **options.dateFields.createdOn** `string` (Optional) Use this instead of 'createdOn' for tracking the POST operations.
- **options.dateFields.modifiedOn** `string` (Optional) Use this instead of 'modifiedOn' for tracking PUT and PATCH operations.
- **options.dateFields.deletedOn** `string` (Optional) Use this instead of 'deletedOn' for tracking DELETE operations.

**Returns**
- an `express.Router` that exposes the collection via a REST API.

## Additional APIs

The following functions may be useful when implementing your own business logic around create or update operations (POST, PUT, PATCH).

### applyPatchRequest

A method that applies a PATCH request to an object. The request can be ether a [JSON Patch][jp] payload or query parameters.

Will throw a **ValidationError** if the payload is not a [JSON Patch][jp].

**Example**

```javascript
router.patch(`/api/v1/example`, (req:Request, res:Response)=>{
  const origObject = { /* ... get the original object */ }
  try {
    const patched = applyPatchRequest(origObject, req)
    // ... do something with the patched object ... maybe validate it?
  } catch (e) {
    handleValidationError(e, res)
  }
})
```

### getValidate

Returns two functions, `validate` and `validateBulk`.

**Parameters**

- `schema` The JSON Schema to validate payloads against
- `options.dateFields.added` (Optional) Use this field instead of `added` to
   record when the document was added to the collection.
- `options.dateFields.lastModified` Use this field instead of `lastModified` to
   record when the document was last modified.
- `options.dateFields.deleted` Use this field instead of `deleted` to
   record when the document was archived.

**Returns**

Two functions, **validate** which will return a typed object or throw a **ValidationError**, and **validateBulk** that will validate either a single
object or an array of objects.

```javascript
function validate<T>(payload:unknown, allowMangedDates:boolean):T
function validateBulk<T>(payload:unknown, allowManagedDates):T|T[]
```

The **allowManagedDates** function will add the dateFields to the document in
order to validate update payloads where those field might exist (PUT and PATCH).

### handleValidationError

Sends a 400 Bad Request response when a **SyntaxError** (likely due to invalid JSON) or a **ValidationError** is thrown. Returns a payload with an `error` field and either
`jsonParseError` or `validationErrors` with the details.

Rethrows the error if it is not either of those.

**Parameters**

- `error` The caught error
- `res` The response object

**Example**

```javascript
router.post('/api/v1/my-collection', json(), (req:Request, res:Response) => {
  const { validateBulk } = getValidate(myJSONSchema)
  try {
    validateBulk(req.body)
    // ... do something with the body
  } catch (e) {
    handleValidationError(e, res)
  }
})
```
### withDb

A middleware function that attaches a Mongo database instance (`mongodb.Db`) to the request
at `req.locals.db`. The database connection is defined by the env var `MONGO_URL`.

**Parameters**

- `db` (Optional) A string (ie., a mongoDb url), a mongodb.Db, or a function that returns
  a Db. If db is undefined the `MONGO_URL` env var will be used.

**Returns**

An express middleware that sets `req.locals.db`.

### ValidationError

An error thrown when the object does not conform to the schema.

**Fields**

- `errors` A list of **ErrorObjects**

  ```javascript
  interface ErrorObject {
    keyword: string // validation keyword.
    instancePath: string // JSON Pointer to the location in the data instance (e.g., `"/prop/1/subProp"`).
    schemaPath: string // JSON Pointer to the location of the failing keyword in the schema
    params: object // type is defined by keyword value, see below
                  // params property is the object with the additional information about error
                  // it can be used to generate error messages
                  // (e.g., using [ajv-i18n](https://github.com/ajv-validator/ajv-i18n) package).
                  // See below for parameters set by all keywords.
    propertyName?: string // set for errors in `propertyNames` keyword schema.
                          // `instancePath` still points to the object in this case.
    message?: string // the error message (can be excluded with option `messages: false`).
    // Options below are added with `verbose` option:
    schema?: any // the value of the failing keyword in the schema.
    parentSchema?: object // the schema containing the keyword.
    data?: any // the data validated by the keyword.
  }
  ```


## TODO
- Add business logic callbacks as options
