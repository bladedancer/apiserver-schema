const jp = require('jsonpath');

const groupColor='#dbcf94';
const scopeColor='#ebda84';

function resourceScopes(definitions) {
    return [...new Set(definitions.map(d => d.scope))];
}

function groupNames(definitions) {
    return [...new Set(definitions.map(d => d.group))];
}

function resourceKinds(definitions) {
    return [...new Set(definitions.map(d => d.kind))];
}

function versionNames(definitions) {
    return [...new Set(definitions.flatMap(d => d.spec.versions.map(v => v.name)))];
}

function resourceKey(resource, version) {
    if (!resource.scope) {
        return `${resource.group}_${resource.kind}_${version}`;
    } else {
        return `${resource.group}_${safeName(resource.scope)}_${resource.kind}_${version}`;
    }
}

function graphResources(group, definitions) {
    // Graph the versions and the nodes
    let viz = '';

    // Graph unscoped resources
    const unscoped = definitions.filter(d => !d.scope);
    unscoped.forEach(d => {
        d.spec.versions.forEach(ver => {
            viz += `${resourceKey(d, ver.name)} [ label = "${d.kind} (${ver.name})" ];\n`
        })
    })

    // In each scope draw the resources
    const scopes = [...new Set(definitions.filter(d => d.scope).map(d => d.scope))];
    scopes.forEach(scope => {
        const scoped = definitions.filter(d => d.scope === scope);
        viz += `subgraph cluster_${group}_${safeName(scope)} {
            style=filled;
            color="${scopeColor}";
            node [style=filled,color=white,shape=rect];
            label="${scope}";
        `;
        scoped.forEach(d => {
            d.spec.versions.forEach(ver => {
                viz += `${resourceKey(d, ver.name)} [ label = "${d.kind} (${ver.name})" ];\n`
            })
        })
        viz += '\n};'
    });

    return viz;
}

function graph(rawdefs) {
    let viz = `graph schema {
        rankdir=BT;
        size=10;\n`;


    // Expand dynamic scopes
    definitions = []
    for (let def of rawdefs) {
        if (!def.scope) {
            // And if it's not scoped no expansion required.
            definitions.push(def);
            continue;
        }

        if (def.group == "core") {
            let clone = JSON.parse(JSON.stringify(def));
            clone.scope = clone.scope.replaceAll(" ", "");
            // Core are rendered shared for now....looks prettier
            definitions.push(clone);
            continue;
        }

        def.scope.split("|").map(s => s.trim()).forEach(s => {
            let clone = JSON.parse(JSON.stringify(def));
            // Stripping group from scope 
            let parts = s.split("/").map(s => s.trim());
            if (parts.length > 1) {
                parts.shift();
            }
            clone.scope = parts.join("/");
            definitions.push(clone);
        })
        
    }

    // Log them all
    console.log("----------------------------------");
    definitions.forEach(d => console.log(d.group, d.scope, d.kind));
    console.log("----------------------------------");

    groupNames(definitions).forEach(group => {
        viz += `\nsubgraph cluster_${group} {
            style=filled;
            color="${groupColor}";
            node [style=filled,color=white,shape=rect];
            label="${group}";
            ${graphResources(group, definitions.filter(d => d.group === group))}
        };\n`
    });

    // Draw the references
    definitions.forEach(sourceDef => {
        sourceDef.spec.versions.forEach( sv => {
            const source = resourceKey(sourceDef, sv.name);

            // Find any references
            jp.paths(sv, '$..["x-amplify-kind-ref"]')
                .filter(p => p.length)
                .forEach(p => {
                    const annotation = jp.value(sv, p);
                    let targetKind = annotation;
                    
                    // split on |, 1 grp, 2, scopekind, 3 resource kind (but reverse optionality)
                    let group = sourceDef.group;
                    let scope = sourceDef.scope;

                    for (let kind of targetKind.split("|").map(s => s.trim())) {
                        if (!kind) {
                            continue
                        }
                        const parts = kind.split("/");
                        if (parts.length == 3) {
                            group = parts[0];
                            scope = parts[1];
                            targetKind = parts[2];
                        } else if (parts.length == 2) {
                            if (isGroupName(parts[0])) {
                                group = parts[0];
                                scope = undefined;
                                targetKind = parts[1];
                            } else {
                                scope = parts[0];
                                targetKind = parts[1];
                            }
                        } else {
                            targetKind = parts[0];
                        }
                    
                        console.log(group, scope, targetKind);
                        let targetResource = definitions.filter(d => referenceMatch(d, group, scope, targetKind))[0];

                        if (!targetResource) {
                            // Try global scope
                            targetResource = definitions.filter(d => referenceMatch(d, group, null, targetKind))[0];
                        }

                        if (!targetResource) {
                            //throw "Unable to find reference: " + annotation + " on " + sourceDef.kind;
                            continue
                        }

                        const refTypePath = [...p];
                        refTypePath.splice(p.length-1, p.length-1, 'x-amplify-kind-ref-type');
                        const isHard = jp.value(sv, refTypePath) != 'soft';
                        
                        const fieldPath = [...p].filter((fp, i) => 
                            i > 3 && i < p.length - 1 && fp !== 'items' && fp !== 'properties'
                        ).join('.');

                        const isArray = [...p].filter((fp, i) => fp === 'items').length > 0;

                        targetResource.spec.versions.forEach(tv => {
                            const target = resourceKey(targetResource, tv.name);
                            viz += `${source} -- ${target} [label="${fieldPath}",taillabel="*",headlabel="${isArray? '*' : ''}",style="${isHard? 'bold': 'dashed'}"];\n`;
                        });
                    }
                });
        });
    });

    viz += '}\n';

    return viz
}

function referenceMatch(resource, group, scope, kind) {
    if (resource.kind !== kind) {
        return false;
    }

    if (resource.scope && resource.group == "core") {
        for (let groupscope of resource.scope.split("|").map(s => s.trim())) {
            const gs = groupscope.split("/");
            const g = gs.length > 1 ? gs[0] : resource.group;
            const s = gs.length > 1 ? gs[1] : gs[0];
            if (g === group && (s === scope || s === '*')) {
                return true;
            }
        }
    } else {
        return resource.group === group && (resource.scope ? resource.scope === scope : !scope);
    }
}

function safeName(name) {
    return name.replace(/:/g, '_').replace(/\//g, '_').replace(/\|/g, '_').replace(/\*/g, 'star');
}

function isGroupName(name) {
    leadingChar = name.charAt(0);
    return leadingChar != leadingChar.toUpperCase();
}

module.exports = graph