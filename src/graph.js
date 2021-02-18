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

function graph(definitions) {
    let viz = `graph schema {
        rankdir=BT;
        size=10;\n`;

    groupNames(definitions).forEach(group => {
        viz += `subgraph cluster_${group} {
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
                    
                    // split on |, 1 grp, 2, scopekind, 3 resource kind
                    let group = sourceDef.group;
                    let scope = sourceDef.scope;

                    for (let kind of targetKind.split("|")) {
                        if (!kind) {
                            continue
                        }
                        const parts = kind.split(":");
                        if (parts.length == 3) {
                            group = parts[0];
                            scope = parts[1];
                            targetKind = parts[2];
                        } else if (parts.length == 2) {
                            scope = parts[0];
                            targetKind = parts[1];
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
                            throw "Unable to find reference: " + annotation + " on " + sourceDef.kind;
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

    if (resource.group === "core" && resource.scope) {
        for (let groupscope of resource.scope.split("|")) {
            const gs = groupscope.split(":");
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
    return name.replace(/:/g, '_').replace(/\|/g, '_').replace(/\*/g, 'star');
}

module.exports = graph