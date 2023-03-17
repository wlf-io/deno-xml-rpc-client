import type { Buffer } from "../deps.ts";


export type BasicArray = BasicType[];
export type BasicType = string|number|boolean|null|BasicObj|BasicArray|Date|Buffer;
export type BasicObj = {[key:string]:BasicType};
