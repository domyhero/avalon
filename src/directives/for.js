
var patch = require('../strategy/patch')
var Cache = require('../seed/cache')

avalon._each = function (obj, fn) {
    if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) {
            var item = obj[i]
            var type = typeof item
            var key = item && type === 'object' ? item.$hashcode : type + item
            fn(i, obj[i], key)
        }
    } else {
        for (var i in obj) {
            if (obj.hasOwnProperty(i)) {
                fn(i, obj[i], i)
            }
        }
    }
}
var rforPrefix = /ms-for\:\s*/
var rforLeft = /^\s*\(\s*/
var rforRight = /\s*\)\s*$/
var rforSplit = /\s*,\s*/
var rforAs = /\s+as\s+([$\w]+)/
var rident = require('../seed/regexp').ident
var rinvalid = /^(null|undefined|NaN|window|this|\$index|\$id)$/
avalon.directive('for', {
    parse: function (str, num) {
        var aliasAs
        str = str.replace(rforAs, function (a, b) {
            if (!rident.test(b) || rinvalid.test(b)) {
                avalon.error('alias ' + b + ' is invalid --- must be a valid JS identifier which is not a reserved name.')
            } else {
                aliasAs = b
            }
            return ''
        })
        var arr = str.replace(rforPrefix, '').split(' in ')
        var assign = 'var loop' + num + ' = ' + avalon.parseExpr(arr[1]) + '\n'
        var alias = aliasAs ? 'var ' + aliasAs + ' = loop' + num + '\n' : ''
        //  var forValue = 'vnode' + num + '.forValue = loop' + num + '\n'
        var kv = arr[0].replace(rforLeft, '').replace(rforRight, '').split(rforSplit)
        if (kv.length === 1) {
            kv.unshift('$key')
        }

        return assign + alias + 'avalon._each(loop' + num + ', function(' + kv + ', traceKey){\n\n'
    },
    diff: function (current, previous, __index__) {

        var cur = current[__index__]
        var pre = previous[__index__] || {}

        var isInit = !('directive' in pre)
        var isChange = false, i, c, p
        if (isInit) {
            pre.components = []
            pre.repeatCount = 0
        }
        var nodes = current.slice(cur.start, cur.end)
        cur.endRepeat = pre.endRepeat
        cur.components = getComponents(nodes.slice(1, -1), cur.signature)
        var n = nodes.length - pre.repeatCount
        if (n > 0) {
            var spliceArgs = [__index__, 0]
            for (var i = 0; i < n; i++) {
                spliceArgs.push(null)
            }
            previous.splice.apply(previous, spliceArgs)
        } else {
            previous.splice.apply(previous, [__index__, Math.abs(n)])
        }
        cur.action = isInit ? 'init' : 'update'
        if (!isInit) {
            var cache = {}
            cur.removedComponents = {}
            /* eslint-disable no-cond-assign */
            var quota = 0
            for (i = 0; c = cur.components[i++]; ) {
                /* eslint-enable no-cond-assign */
                quota++
                saveInCache(cache, c)
            }
            /* eslint-disable no-cond-assign */
            for (i = 0; p = pre.components[i++]; ) {
                /* eslint-enable no-cond-assign */
                c = isInCache(cache, p.key)
                if (c) {
                    quota--
                    if (!isChange) {//如果位置发生了变化
                        isChange = c.index !== p.index
                    }
                    c.nodes = p.nodes
                    avalon.diff(c.children, p.children)
                } else {
                    if (quota) {
                        c = fuzzyMatchCache(cache, p.key)
                        quota--
                        isChange = true //内容发生变化
                        c.nodes = p.nodes
                        avalon.diff(c.children, p.children)
                    } else {
                        isChange = true
                        cur.removedComponents[p.index] = p
                    }

                }
            }
            //这是新添加的元素
            for (i in cache) {
                isChange = true
                c = cache[i]
                avalon.diff(c.children, [])
            }

        } else {
            /* eslint-disable no-cond-assign */
            for (i = 0; c = cur.components[i++]; ) {
                /* eslint-enable no-cond-assign */
                avalon.diff(c.children, [])
            }
            isChange = true
        }
        pre.components.length = 0 //release memory
        if (isChange) {
            var list = cur.change || (cur.change = [])
            avalon.Array.ensure(list, this.update)
        }

        return __index__ + nodes.length - 1

    },
    update: function (startRepeat, vnode, parent) {

        var action = vnode.action
        var endRepeat = vnode.endRepeat

        var fragment = document.createDocumentFragment()
        if (action === 'init') {
            var node = startRepeat.nextSibling
            while (node && node !== endRepeat) {
                parent.removeChild(node)
                node = startRepeat.nextSibling
            }
        }

        for (var i in vnode.removedComponents) {
            var el = vnode.removedComponents[i]
            if (el.nodes) {
                el.nodes.forEach(function (n) {
                    if (n.parentNode) {
                        n.parentNode.removeChild(n)
                    }
                })
                el.nodes.length = el.children.length = 0
            }

        }
        delete vnode.removedComponents
        var insertPoint = startRepeat
        for (var i = 0; i < vnode.components.length; i++) {
            var com = vnode.components[i]
            var cnodes = com.nodes
            if (cnodes) {
                if (insertPoint.nextSibling !== cnodes[0]) {
                    var moveFragment = fragment.cloneNode(false)
                    cnodes.forEach(function (node) {
                        moveFragment.appendChild(node)
                    })
                    parent.insertBefore(moveFragment, insertPoint.nextSibling)
                }

            } else {
                var newFragment = fragment.cloneNode(false)
                componentToDom(com, newFragment)
                cnodes = com.nodes
                parent.insertBefore(newFragment, insertPoint.nextSibling)
            }
            insertPoint = cnodes[cnodes.length - 1]
        }
        var entity = [], vnodes = []
        vnode.components.forEach(function (c) {
            entity.push.apply(entity, c.nodes)
            vnodes.push.apply(vnodes, c.children)
        })
        vnode.repeatCount = vnodes.length
        patch(entity, vnodes, parent)
        return false
    }

})


var forCache = new Cache(128)
function componentToDom(com, fragment, cur) {
    com.nodes = []
    com.children.forEach(function (c) {
        if (c.type.charAt(0) === '#') {
            var expr = c.type + '#' + c.nodeValue
            var node = forCache.get(expr)
            if (!node) {
                node = avalon.vdomAdaptor(c).toDOM()
                forCache.put(expr, node)
            }
            cur = node.cloneNode(true)
        } else {
            cur = avalon.vdomAdaptor(c).toDOM()
        }
        com.nodes.push(cur)
        fragment.appendChild(cur)
    })
    return fragment
}

//将要循环的节点根据锚点元素再分成一个个更大的单元,用于diff
function getComponents(nodes, signature) {
    var components = []
    var com = {
        children: []
    }
    for (var i = 0, el; el = nodes[i]; i++) {
        if (el.type === '#comment' && el.nodeValue === signature) {
            com.children.push(el)
            com.key = el.key
            com.index = components.length
            components.push(com)
            com = {
                children: []
            }
        } else {
            com.children.push(el)
        }
    }
    return components
}

var rfuzzy = /^(string|number|boolean)/
var rkfuzzy = /^_*(string|number|boolean)/
function fuzzyMatchCache(cache, id) {
    var m = id.match(rfuzzy)
    if (m) {
        var fid = m[1]
        for (var i in cache) {
            var n = i.match(rkfuzzy)
            if (n && n[1] === fid) {
                return isInCache(cache, i)
            }
        }
    }
}

// 新位置: 旧位置
function isInCache(cache, id) {
    var c = cache[id]
    if (c) {
        var stack = [{id: id, c: c}]
        while (1) {
            id += '_'
            if (cache[id]) {
                stack.push({
                    id: id,
                    c: cache[id]
                })
            } else {
                break
            }
        }
        var a = stack.pop()
        delete cache[a.id]
        return a.c
    }
    return c
}

function saveInCache(cache, component) {
    var trackId = component.key
    if (!cache[trackId]) {
        cache[trackId] = component
    } else {
        while (1) {
            trackId += '_'
            if (!cache[trackId]) {
                cache[trackId] = component
                break
            }
        }
    }
}
