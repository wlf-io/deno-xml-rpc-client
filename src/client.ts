import { BasicArray, BasicType } from "./types.ts";
import { Serializer } from "./serializer.ts";
import { Buffer } from "../deps.ts";
import { Deserializer } from "./deserializer.ts";

export class Client {

    private options: ClientOptions;

    constructor(options:string|URL|ClientOptions) {
        if(typeof options === "string" || options instanceof URL){
            options = parseClientOptions(options);
        }
        this.options = options;
    }

    public async methodCall(method:string, params:BasicArray) :Promise<BasicType> {

        console.log(Serializer.serializeMethodCall(method,params));
        const content = Serializer.serializeMethodCall(method,params);
        
        const buf = new Buffer(new TextEncoder().encode(content));


        const response = await fetch(this.options.url,{
            method: "POST",
            headers: {
                "User-Agent"    : "Deno XML-RPC Client",
                "Content-Type"  : "text/xml",
                "Accept"        : "text/xml",
                "Accept-Charset": "UTF8",
                "Connection"    : "Keep-Alive",
                "Content-Length": buf.length.toString(),
            },
            body: content,
        });
        const text = await response.text();

        const deserializer = new Deserializer();

        const result = await deserializer.deserializeMethodResponse(text);

        return result;
    }
}


const parseClientOptions = (url:string|URL) : ClientOptions => {
    if(typeof url === "string"){
        url = new URL(url);
    }
    return {
        url: url,
        timeout: 60,
        method: "POST",
    };
}

type ClientOptions = {
    url: string|URL;
    timeout: number;
    method: string;
}
