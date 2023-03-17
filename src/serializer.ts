import { BasicArray, BasicType } from "./types.ts";
// @deno-types="npm:@types/xmlbuilder"
import { Buffer, xmlbuilder } from "../deps.ts";
import { DateFormatter } from "./date_formatter.ts";

const dateFormatter = new DateFormatter();

export class Serializer {
  public static serializeMethodCall(
    method: string,
    params: BasicArray,
  ): string {
    const xml = xmlbuilder.create("methodCall", {
      version: "1.0",
      allowSurrogateChars: true,
    });
    xml.ele("methodName").txt(method);
    const xmlParams = xml.ele("params");
    params.forEach((param) => {
      serializeValue(param, xmlParams.ele("param"));
    });
    return xml.doc().toString();
  }
}

type xmlElem = {
  ele: (s: string) => xmlElem;
  txt: (s: string | number) => xmlElem;
  text: (s: string | number) => xmlElem;
  d: (s: string) => xmlElem;
  up: () => xmlElem;
};

type SerializeStackItem = {
  value: BasicType;
  xml: xmlElem;
  index?: number;
  keys?: string[];
};

const serializeValue = (value: BasicType, xml: xmlElem) => {
  // @ts-ignore
  //xml.txt(JSON.stringify(param));

  const stack: SerializeStackItem[] = [{ value: value, xml: xml }];
  let current = null;
  let valueNode = null;
  let next = null;

  while (stack.length > 0) {
    current = stack[stack.length - 1];

    if (current.index !== undefined) {
      // Iterating a compound
      next = getNextItemsFrame(current);
      if (next) {
        stack.push(next);
      } else {
        stack.pop();
      }
    } else {
      // we're about to add a new value (compound or simple)
      valueNode = current.xml.ele("value");
      switch (typeof current.value) {
        case "boolean":
          appendBoolean(current.value, valueNode);
          stack.pop();
          break;
        case "string":
          appendString(current.value, valueNode);
          stack.pop();
          break;
        case "number":
          appendNumber(current.value, valueNode);
          stack.pop();
          break;
        case "object":
          if (current.value === null) {
            valueNode.ele("nil");
            stack.pop();
          } else if (current.value instanceof Date) {
            appendDatetime(current.value, valueNode);
            stack.pop();
          } else if (current.value instanceof Buffer) {
            appendBuffer(current.value, valueNode);
            stack.pop();
          } else if (current.value instanceof CustomType) {
            current.value.serialize(valueNode);
            stack.pop();
          } else {
            if (Array.isArray(current.value)) {
              current.xml = valueNode.ele("array").ele("data");
            } else {
              current.xml = valueNode.ele("struct");
              current.keys = Object.keys(current.value);
            }
            current.index = 0;
            next = getNextItemsFrame(current);
            if (next) {
              stack.push(next);
            } else {
              stack.pop();
            }
          }
          break;
        default:
          stack.pop();
          break;
      }
    }
  }
};

function getNextItemsFrame(frame: SerializeStackItem) {
  let nextFrame = null;

  if (!frame.index) frame.index = 0;
  if (frame.keys) {
    if (frame.index < frame.keys.length) {
      const key = frame.keys[frame.index++];
      const member = frame.xml.ele("member").ele("name").text(key).up();
      nextFrame = {
        // @ts-ignore
        value: frame.value[key],
        xml: member,
      };
    }
    // @ts-ignore
  } else if (frame.index < frame.value.length) {
    nextFrame = {
      // @ts-ignore
      value: frame.value[frame.index],
      xml: frame.xml,
    };
    frame.index++;
  }

  return nextFrame;
}

function appendBoolean(value: boolean, xml: xmlElem) {
  xml.ele("boolean").txt(value ? 1 : 0);
}

const illegalChars = /^(?![^<&]*]]>[^<&]*)[^<&]*$/;
function appendString(value: string, xml: xmlElem) {
  if (value.length === 0) {
    xml.ele("string");
  } else if (!illegalChars.test(value)) {
    xml.ele("string").d(value);
  } else {
    xml.ele("string").txt(value);
  }
}

function appendNumber(value: number, xml: xmlElem) {
  if (value % 1 == 0) {
    xml.ele("int").txt(value);
  } else {
    xml.ele("double").txt(value);
  }
}

function appendDatetime(value: Date, xml: xmlElem) {
  xml.ele("dateTime.iso8601").txt(dateFormatter.encodeIso8601(value));
}

function appendBuffer(value: Buffer, xml: xmlElem) {
  xml.ele("base64").txt(value.toString("base64"));
}

class CustomType {
  private raw: string;
  private tagName = "customType";

  constructor(raw: string) {
    this.raw = raw;
  }

  serialize(xml: xmlElem) {
    return xml.ele(this.tagName).txt(this.raw);
  }
}
