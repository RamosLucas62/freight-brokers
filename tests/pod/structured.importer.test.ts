import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import ExcelJS from 'exceljs';
import {StructuredPodImporter} from '../../src/pod/structured.importer.js';
let dir='';afterEach(async()=>{if(dir)await rm(dir,{recursive:true,force:true});});
describe('structured POD importer',()=>{
 it('imports quoted CSV and preserves identifiers',async()=>{dir=await mkdtemp(join(tmpdir(),'pod-'));const file=join(dir,'pods.csv');await writeFile(file,'load_number,bol_number,receiver,signature,notes\n"00123","B,7",Ana,yes,"box, damaged"\n');const [pod]=await new StructuredPodImporter().import(file);expect(pod.fields.load_number.value).toBe('00123');expect(pod.fields.bol_number.value).toBe('B,7');expect(pod.fields.signature_present.value).toBe(true);expect(pod.source_kind).toBe('csv');});
 it('imports the first Excel worksheet',async()=>{dir=await mkdtemp(join(tmpdir(),'pod-'));const file=join(dir,'pods.xlsx');const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('PODs');sheet.addRows([['Load Number','Delivery Date','Signed'],['0009','2026-09-08',false]]);await workbook.xlsx.writeFile(file);const [pod]=await new StructuredPodImporter().import(file);expect(pod.fields.load_number.value).toBe('0009');expect(pod.fields.delivery_date.value).toBe('2026-09-08');expect(pod.fields.signature_present.value).toBe(false);expect(pod.source_kind).toBe('xlsx');});
});
