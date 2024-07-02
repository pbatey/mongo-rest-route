export default {
  "$async": true, // important so that the validate method throws errors
  "type": "array",
  "items": {
    "oneOf": [ {
      "type": "object",
      "properties": {
        "op": { "enum": [ "add", "replace", "test" ]},
        "path": {
          "type": "string",
          "pattern": "^(\/([^~/]|~[01])*)*$"
        },
        "value": {}
      },
      "required": [ "op", "path", "value" ]
    }, {
      "type": "object",
      "properties": {
        "op": { "enum": [ "remove" ]},
        "path": {
          "type": "string",
          "pattern": "^(\/([^~/]|~[01])*)*$"
        }
      },
      "required": [ "op", "path" ]
    }, {
      "type": "object",
      "properties": {
        "op": { "enum": [ "move", "copy" ]},
        "from": {
          "type": "string",
          "pattern": "^(\/([^~/]|~[01])*)*$"
        },
        "path": {
          "type": "string",
          "pattern": "^(\/([^~/]|~[01])*)*$"
        }
      },
      "required": [ "op", "from", "path" ]
    } ]
  }
}