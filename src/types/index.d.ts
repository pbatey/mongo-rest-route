// src/types/express/index.d.ts

import { Db } from "mongodb"

// to make the file a module and avoid the TypeScript error
export {}

declare global {
  namespace Express {
    export interface Request {
      locals: {
        db: Db
      }
    }
  }
}