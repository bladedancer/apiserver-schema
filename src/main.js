const graph = require('./graph');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const isDirectory = p => fs.statSync(p).isDirectory();
const getDirectories = p => fs.readdirSync(p).map(name => path.join(p, name)).filter(isDirectory);
const isFile = p => fs.statSync(p).isFile();  
const getFiles = p => fs.readdirSync(p).map(name => path.join(p, name)).filter(isFile);

const getFilesRecursively = (p) => {
    let dirs = getDirectories(p);
    let files = dirs
        .map(dir => getFilesRecursively(dir)) // go through each directory
        .reduce((a,b) => a.concat(b), []);    // map returns a 2d array (array of file arrays) so flatten
    return files.concat(getFiles(p));
};

function loadYaml() {
    let defs = [];
    getFilesRecursively(path.join(__dirname, '..', 'schema')).forEach(name => {
        const defYaml = fs.readFileSync(name, 'utf-8');
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