import { SAXParser } from "../deps.ts";
import { DateFormatter } from "./date_formatter.ts";
import { BasicArray,BasicObj,BasicType } from "./types.ts";
import {Buffer, decode64} from "../deps.ts";

const isInteger = /^-?\d+$/;

const dateFormatter = new DateFormatter();

export class Deserializer {
    type: "methodcall" | "methodresponse" | null = null;
    responseType: "params" | "fault" | null = null;
    stack: BasicArray = [];
    marks: number[] = [];
    data: string[] = [];
    methodname: null|string = null;
    encoding: string;
    value = false;
    resolve!: (result: BasicArray)=>void;
    reject!: (error:Error) => void;
    error: null | Error = null;
    parser: SAXParser;
    constructor(encoding: string = "utf8") {
        this.encoding = encoding;

        this.parser = new SAXParser(false, {});
        this.parser.onopentag = (node:{name:string}) => this.onOpentag(node);
        this.parser.onclosetag = (tag:string) => this.onClosetag(tag);
        this.parser.ontext = (text:string)=>this.onText(text);
        this.parser.oncdata = (text:string) => this.onCDATA(text);
        this.parser.onend = () => this.onDone();
        this.parser.onerror = (e:Error) => this.onError(e);
    }


    public deserializeMethodResponse(xml: string): Promise<BasicType> {
        return new Promise((resolve, reject) => {
            let rej = false;
            this.resolve = (result:BasicArray) => {
                if(rej) reject(new Error("Already Rejected"));
                else if (result.length > 1) reject(new Error('Response has more than one param'));
                else if (this.type !== 'methodresponse') reject(new Error('Not a method response'));
                else if (!this.responseType) reject(new Error('Invalid method response'));
                else resolve(result[0]);
            };
            this.reject = (e:Error) => {
                rej = true;
                reject(e);
            };
            this.parser.write(xml).close();
        });
    }

    public deserializeMethodCall(xml:string): Promise<[string,BasicType]>{
        return new Promise((resolve, reject) => {
            let rej = false;
            this.resolve = (result:BasicArray) => {
                if(rej) reject(new Error("Already Rejected"));
                else if (this.type !== 'methodcall') reject(new Error('Not a method call'));
                else if (!this.methodname) reject(new Error('Method call did not contain a method name'));
                else resolve([this.methodname,result[0]]);
            };
            this.reject = (e:Error) => {
                rej = true;
                reject(e);
            };
            this.parser.write(xml).close();
        });
    }

    private onDone() {
        if (!this.error) {
            if (this.type === null || this.marks.length) {
                this.reject(new Error('Invalid XML-RPC message'))
            }
            else if (this.responseType === 'fault') {
                const createFault = function (fault:Fault) {
                    const error = new Fault('XML-RPC fault' + (fault.faultString ? ': ' + fault.faultString : ''));
                    error.code = fault.faultCode
                    error.faultCode = fault.faultCode
                    error.faultString = fault.faultString
                    return error
                }
                // @ts-ignore
                this.reject(createFault(this.stack[0] as Fault))
            }
            else {
                this.resolve(this.stack)
            }
        }
    }

    private onError(msg: string | Error) {
        if (!this.error) {
            if (typeof msg === 'string') {
                this.error = new Error(msg)
            }
            else {
                this.error = msg
            }
            this.reject(this.error);
        }
    }

    private push(value:BasicType) {
        this.stack.push(value)
    }


    private onOpentag(node:{name:string}) {
        if (node.name === 'ARRAY' || node.name === 'STRUCT') {
            this.marks.push(this.stack.length)
        }
        this.data = []
        this.value = (node.name === 'VALUE')
    }

    private onText(text:string) {
        this.data.push(text)
    }

    private onCDATA(cdata:string) {
        this.data.push(cdata)
    }

    private onClosetag(el:string) {
        const data = this.data.join('');
        try {
            switch (el) {
                case 'BOOLEAN':
                    this.endBoolean(data)
                    break
                case 'INT':
                case 'I4':
                    this.endInt(data)
                    break
                case 'I8':
                    this.endI8(data)
                    break
                case 'DOUBLE':
                    this.endDouble(data)
                    break
                case 'STRING':
                case 'NAME':
                    this.endString(data)
                    break
                case 'ARRAY':
                    this.endArray(data)
                    break
                case 'STRUCT':
                    this.endStruct(data)
                    break
                case 'BASE64':
                    this.endBase64(data)
                    break
                case 'DATETIME.ISO8601':
                    this.endDateTime(data)
                    break
                case 'VALUE':
                    this.endValue(data)
                    break
                case 'PARAMS':
                    this.endParams(data)
                    break
                case 'FAULT':
                    this.endFault(data)
                    break
                case 'METHODRESPONSE':
                    this.endMethodResponse(data)
                    break
                case 'METHODNAME':
                    this.endMethodName(data)
                    break
                case 'METHODCALL':
                    this.endMethodCall(data)
                    break
                case 'NIL':
                    this.endNil(data)
                    break
                case 'DATA':
                case 'PARAM':
                case 'MEMBER':
                    // Ignored by design
                    break
                default:
                    this.onError('Unknown XML-RPC tag \'' + el + '\'')
                    break
            }
        }
        catch (e) {
            this.onError(e)
        }
    }

    private endNil(_data:unknown) {
        this.push(null)
        this.value = false
    }

    private endBoolean(data:string) {
        if (data === '1') {
            this.push(true)
        }
        else if (data === '0') {
            this.push(false)
        }
        else {
            this.reject(new Error('Illegal boolean value \'' + data + '\''));
        }
        this.value = false
    }

    private endInt(data:string) {
        const value = parseInt(data, 10);
        if (isNaN(value)) {
            this.reject(new Error('Expected an integer but got \'' + data + '\''));
        }
        else {
            this.push(value)
            this.value = false
        }
    }

    private endDouble(data:string) {
        const value = parseFloat(data);
        if (isNaN(value)) {
            this.reject(new Error('Expected a double but got \'' + data + '\''));
        }
        else {
            this.push(value)
            this.value = false
        }
    }

    private endString(data:string) {
        this.push(data)
        this.value = false
    }

    private endArray(_data:unknown) {
        const mark = this.marks.pop();
        if(typeof mark === "undefined") {
            this.reject(new Error("Marks was empty"));
            return;
        }
        this.stack.splice(mark, this.stack.length - mark, this.stack.slice(mark))
        this.value = false
    }

    private endStruct(_data:unknown) {
        const mark = this.marks.pop();
        if(typeof mark === "undefined") {
            this.reject(new Error("Marks was empty"));
            return;
        }
        const struct:BasicObj = {};
        const items = this.stack.slice(mark);

        for (let i = 0; i < items.length; i += 2) {
            const str = items[i];
            if(typeof str !== "string") {
                this.reject(new Error("Expected string to key struct"));
                return;
            }
            struct[str] = items[i + 1];
        }
        this.stack.splice(mark, this.stack.length - mark, struct)
        this.value = false
    }

    private endBase64(data:string) {
        this.push(new Buffer(decode64(data)));
        this.value = false;
    }

    private endDateTime(data:string) {
        const date = dateFormatter.decodeIso8601(data);
        this.push(date);
        this.value = false;
    }
  
  private endI8(data:string) {
    if (!isInteger.test(data)) {
        this.reject(new Error('Expected integer (I8) value but got \'' + data + '\''));
    }
    else {
        this.endString(data)
    }
}
  
  private endValue(data:string) {
    if (this.value) {
        this.endString(data)
    }
}
  
  private endParams(_data:unknown) {
    this.responseType = 'params'
}
  
  private endFault(_data:string) {
    this.responseType = 'fault'
}
  
  private endMethodResponse(_data:unknown) {
    this.type = 'methodresponse'
}
  
  private endMethodName(data:string) {
    this.methodname = data
}
  
  private endMethodCall(_data:unknown) {
    this.type = 'methodcall'
}
}


class Fault extends Error {
    code = "";
    faultCode = "";
    faultString ="";
}
