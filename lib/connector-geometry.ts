export type ScreenshotBounds={x:number;y:number;width:number;height:number};
export type TouchArea={x:number;y:number;width:number;height:number};
export function tapOrigin(bounds:ScreenshotBounds,area:TouchArea){return {x:bounds.x+(area.x+area.width/2)*bounds.width,y:bounds.y+(area.y+area.height/2)*bounds.height};}
export function pointArea(x:number,y:number):TouchArea{const width=.04,height=.025;return {x:Math.max(0,Math.min(1-width,x-width/2)),y:Math.max(0,Math.min(1-height,y-height/2)),width,height};}
