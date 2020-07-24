const graph = require('./graph');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

function loadYaml() {
    let defs = [];
    ["management", "definitions"].forEach(name => {
        const defPath = path.join(__dirname, '..', 'schema', `${name}.yaml`);
        const defYaml = fs.readFileSync(defPath, 'utf-8');
        defs = [...defs, ...yaml.safeLoadAll(defYaml)];
    });
    
    return defs;
}


function saveGraph(graphText) {
    const graphPath = path.join(__dirname, '..', 'graph.viz');
    fs.writeFileSync(graphPath, graphText, 'utf-8');
}

function main() {
    const definitions = loadYaml();
    saveGraph(graph(definitions));    
}

main();