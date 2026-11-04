import {inflateSync,deflateSync} from 'node:zlib';
// Minimal PNG codec for screenshots: 8-bit, non-interlaced images as produced by screencap and Playwright.
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const CRC=(()=>{const table=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c;}return buffer=>{let c=-1;for(const byte of buffer)c=table[(c^byte)&255]^(c>>>8);return (c^-1)>>>0;};})();
export function decodePng(buffer){
 if(!buffer||buffer.length<8||!buffer.subarray(0,8).equals(SIGNATURE))throw Error('Not a PNG image');
 let offset=8,width=0,height=0,depth=0,colorType=0,interlace=0,palette=null;const data=[];
 while(offset+8<=buffer.length){const length=buffer.readUInt32BE(offset),type=buffer.toString('latin1',offset+4,offset+8),body=buffer.subarray(offset+8,offset+8+length);offset+=12+length;
  if(type==='IHDR'){width=body.readUInt32BE(0);height=body.readUInt32BE(4);depth=body[8];colorType=body[9];interlace=body[12];}
  else if(type==='PLTE')palette=body;else if(type==='IDAT')data.push(body);else if(type==='IEND')break;}
 if(depth!==8||interlace!==0)throw Error('Unsupported PNG: only 8-bit non-interlaced images are decoded');
 const channels={0:1,2:3,3:1,4:2,6:4}[colorType];if(!channels)throw Error('Unsupported PNG color type');
 const raw=inflateSync(Buffer.concat(data)),stride=width*channels,pixels=new Uint8Array(width*height*4);
 let previous=new Uint8Array(stride),position=0;
 for(let y=0;y<height;y++){const filter=raw[position++],row=new Uint8Array(raw.subarray(position,position+stride));position+=stride;
  for(let i=0;i<stride;i++){const a=i>=channels?row[i-channels]:0,b=previous[i],c=i>=channels?previous[i-channels]:0;
   if(filter===1)row[i]=(row[i]+a)&255;else if(filter===2)row[i]=(row[i]+b)&255;else if(filter===3)row[i]=(row[i]+((a+b)>>1))&255;
   else if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);row[i]=(row[i]+(pa<=pb&&pa<=pc?a:pb<=pc?b:c))&255;}}
  for(let x=0;x<width;x++){const o=(y*width+x)*4,s=x*channels;
   if(colorType===6){pixels[o]=row[s];pixels[o+1]=row[s+1];pixels[o+2]=row[s+2];pixels[o+3]=row[s+3];}
   else if(colorType===2){pixels[o]=row[s];pixels[o+1]=row[s+1];pixels[o+2]=row[s+2];pixels[o+3]=255;}
   else if(colorType===0){pixels[o]=pixels[o+1]=pixels[o+2]=row[s];pixels[o+3]=255;}
   else if(colorType===4){pixels[o]=pixels[o+1]=pixels[o+2]=row[s];pixels[o+3]=row[s+1];}
   else{const p=row[s]*3;pixels[o]=palette?.[p]??0;pixels[o+1]=palette?.[p+1]??0;pixels[o+2]=palette?.[p+2]??0;pixels[o+3]=255;}}
  previous=row;}
 return {width,height,pixels};
}
function chunk(type,body){const length=Buffer.alloc(4);length.writeUInt32BE(body.length);const typed=Buffer.concat([Buffer.from(type,'latin1'),body]);const crc=Buffer.alloc(4);crc.writeUInt32BE(CRC(typed));return Buffer.concat([length,typed,crc]);}
export function encodePng({width,height,pixels}){
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++){raw[y*(width*4+1)]=0;raw.set(pixels.subarray(y*width*4,(y+1)*width*4),y*(width*4+1)+1);}
 return Buffer.concat([SIGNATURE,chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
/** Nearest-neighbour downscale used for versionable thumbnails. */
export function scalePng(image,maxWidth){
 if(image.width<=maxWidth)return image;const ratio=maxWidth/image.width,width=maxWidth,height=Math.max(1,Math.round(image.height*ratio)),pixels=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++){const sy=Math.min(image.height-1,Math.floor(y/ratio));for(let x=0;x<width;x++){const sx=Math.min(image.width-1,Math.floor(x/ratio)),s=(sy*image.width+sx)*4,o=(y*width+x)*4;pixels[o]=image.pixels[s];pixels[o+1]=image.pixels[s+1];pixels[o+2]=image.pixels[s+2];pixels[o+3]=image.pixels[s+3];}}
 return {width,height,pixels};
}
