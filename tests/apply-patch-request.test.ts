import { ObjectId } from 'mongodb'
import { applyPatchRequest } from '../src/apply-patch-request'
import { Request } from 'express'

describe('apply-patch-request', () => {
  it('should apply query parameters', () => {
    const name = 'Joseph Francis Tribbiani Jr.'
    const req = {
      query: Object.fromEntries(new URLSearchParams(`name=${name}`)),
      body: {}
    } as unknown as Request

    const doc = {_id: new ObjectId()}

    const result = applyPatchRequest(doc, req)
    expect(result.name).toBe(name)
  })

  it('should not allow _id to be modified', () => {
    const req = {
      query: Object.fromEntries(new URLSearchParams(`_id=change-the-id`)),
      body: {}
    } as unknown as Request

    const doc = {_id: new ObjectId()}

    expect(() => {
      const result = applyPatchRequest(doc, req)
    }).toThrow()
  })
})
