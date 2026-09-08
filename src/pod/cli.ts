import 'dotenv/config';
import {processPodFile} from './index.js';

async function main(){
 const files=process.argv.slice(2);if(!files.length)throw new Error('Provide one or more POD files: PDF, JPEG, PNG, WebP, CSV or XLSX.');
 const results=[];for(const file of files)results.push(...await processPodFile(file));
 process.stdout.write(`${JSON.stringify(results,null,2)}\n`);
}
main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'POD processing failed.'}\n`);process.exitCode=1;});
