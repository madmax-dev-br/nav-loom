const request=JSON.parse(process.argv[2]||'{}');
if(request.method==='health')console.log(JSON.stringify({ok:true,sdk:1}));
else if(request.method==='describe'){const graph=request.context.graph;console.log(JSON.stringify({screens:graph.screens.length,configured:Object.keys(graph.extensions.deeplinks??{}).length,requests:[]}));}
else{console.error('Unknown plugin method');process.exitCode=1;}
