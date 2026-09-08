import {readFile} from 'node:fs/promises';
import {extname} from 'node:path';
import ExcelJS from 'exceljs';
import {PodExtractionSchema} from './schema.js';
import type {PodExtractionResult,PodFields} from './types.js';

const aliases:Record<keyof PodFields,string[]>={load_number:['load_number','load','load number'],bol_number:['bol_number','bol','bill of lading','bill_of_lading'],delivery_date:['delivery_date','delivery date','date'],delivery_time:['delivery_time','delivery time','time'],receiver_name:['receiver_name','receiver','received by','consignee'],delivery_location:['delivery_location','delivery location','location','destination'],signature_present:['signature_present','signed','signature'],damage_or_shortage_noted:['damage_or_shortage_noted','damage','shortage','exception'],exception_notes:['exception_notes','notes','exception notes']};
const key=(value:unknown)=>String(value??'').trim().toLowerCase().replace(/[-]+/g,'_');
const text=(value:unknown)=>{const v=String(value??'').trim();return v||null;};
const bool=(value:unknown):boolean|null=>{if(typeof value==='boolean')return value;const v=key(value);if(['true','yes','y','1','sim','signed'].includes(v))return true;if(['false','no','n','0','não','nao','unsigned'].includes(v))return false;return null;};
function parseCsv(content:string):unknown[][]{const firstLine=content.split(/\r?\n/,1)[0]??'';const delimiter=(firstLine.match(/;/g)?.length??0)>(firstLine.match(/,/g)?.length??0)?';':',';const rows:unknown[][]=[];let row:string[]=[];let cell='';let quoted=false;for(let i=0;i<content.length;i++){const char=content[i];if(char==='"'){if(quoted&&content[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(char===delimiter&&!quoted){row.push(cell);cell='';}else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&content[i+1]==='\n')i++;row.push(cell);if(row.some(value=>value.trim()))rows.push(row);row=[];cell='';}else cell+=char;}row.push(cell);if(row.some(value=>value.trim()))rows.push(row);if(quoted)throw new Error('CSV has an unterminated quoted field.');return rows;}
function excelValue(value:unknown):unknown{if(value instanceof Date)return value.toISOString().slice(0,10);if(typeof value!=='object'||value===null)return value;if('result' in value)return excelValue((value as {result:unknown}).result);if('text' in value)return (value as {text:string}).text;if('richText' in value)return (value as {richText:{text:string}[]}).richText.map(part=>part.text).join('');return null;}
function toResult(file:string,kind:'csv'|'xlsx',headers:unknown[],row:unknown[],rowNumber:number):PodExtractionResult{
 const index=new Map(headers.map((header,i)=>[key(header),i]));const get=(name:keyof PodFields)=>{for(const alias of aliases[name]){const found=index.get(key(alias));if(found!=null)return row[found];}return null;};
 const make=<T>(value:T|null)=>({value,confidence:value==null?0:1,evidence:null});
 const fields:PodFields={load_number:make(text(get('load_number'))),bol_number:make(text(get('bol_number'))),delivery_date:make(text(get('delivery_date'))),delivery_time:make(text(get('delivery_time'))),receiver_name:make(text(get('receiver_name'))),delivery_location:make(text(get('delivery_location'))),signature_present:make(bool(get('signature_present'))),damage_or_shortage_noted:make(bool(get('damage_or_shortage_noted'))),exception_notes:make(text(get('exception_notes')))};
 return PodExtractionSchema.parse({source_file:`${file}#row=${rowNumber}`,source_kind:kind,fields,quality:{score:1,rotation_degrees:0,perspective_distortion:false,blur:false,glare_or_shadow:false,cropped:false,reasons:[]},requires_human_review:false,raw:{row:rowNumber}});
}
export class StructuredPodImporter {
 async import(file:string):Promise<PodExtractionResult[]>{
  const extension=extname(file).toLowerCase();let rows:unknown[][];let kind:'csv'|'xlsx';
  if((await readFile(file)).length>20*1024*1024)throw new Error('Structured POD file exceeds 20 MiB.');
  if(extension==='.csv'){kind='csv';rows=parseCsv((await readFile(file)).toString('utf8').replace(/^\uFEFF/,''));}
  else if(extension==='.xlsx'){kind='xlsx';const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(file);const sheet=workbook.worksheets[0];if(!sheet)throw new Error('Excel workbook has no worksheets.');if(sheet.actualRowCount>10001)throw new Error('Excel POD import exceeds 10,000 data rows.');rows=[];sheet.eachRow({includeEmpty:false},row=>{const values=Array.isArray(row.values)?row.values:[];rows.push(values.slice(1).map(excelValue));});}
  else throw new Error('Unsupported structured POD format. Use CSV or XLSX.');
  if(rows.length<2)throw new Error('Structured POD file must contain a header and at least one data row.');if(rows.length>10001)throw new Error('Structured POD import exceeds 10,000 data rows.');
  return rows.slice(1).map((row,index)=>toResult(file,kind,rows[0],row,index+2));
 }
}
