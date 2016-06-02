var update = require('./_update')
var parseView = require('../strategy/parser/parseView')
var cache = {}
avalon.htmlFactory = function (str) {
    if (cache[str]) {
        return cache[str]
    } else {
        var vtree = avalon.lexer(str + '')
        return  (cache[str] = '(function(){' + parseView(vtree) + '})();')
    }
}

avalon.directive('html', {
   parse: function (cur, pre, binding) {
           if (!pre.isVoidTag) {
            //将渲染函数的某一部分存起来,渲在c方法中转换为函数
            cur.props[binding.name] = avalon.parseExpr(binding)
            cur.children = '[]'
            pre.$append = '\nvar el = vnodes[vnodes.length-1];\n' +
                    'var HTMLRaw =  el["ms-html"];;\n' +
                    'var HTMLParsed = avalon.htmlFactory(HTMLRaw);\n' +
                    'try{eval("el.children = " + HTMLParsed )}catch(e){};\n'
        }
    },
    diff: function (cur, pre, steps, name) {
        var curValue = cur[name]
        var preValue = pre[name]
        if (curValue !== preValue) {
            update(cur, this.update, steps, 'html' )
        }
    },
    update: function (node, vnode) {
        if (node.nodeType !== 1) {
            return
        }
        //添加节点
        avalon.clearHTML(node)
        var fragment = document.createDocumentFragment()
        vnode.children.forEach(function (c) {
            c && fragment.appendChild(avalon.vdomAdaptor(c, 'toDOM'))
        })
    }
})