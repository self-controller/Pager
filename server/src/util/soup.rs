//! A small, forgiving tag-soup parser with htmlparser2's shape: a flat arena of elements and text,
//! tags and attribute names lower-cased in HTML mode, self-closing tags honoured, void elements and
//! the usual implied closes (`<p>` closed by a block, `<li>` by `<li>`, ...). In XML mode names keep
//! their case and nothing is implied. Comments, doctypes and processing instructions are dropped.

use std::collections::HashMap;
use std::sync::OnceLock;

pub type NodeId = usize;

#[derive(Debug, Clone)]
pub enum NodeKind {
    Element { name: String, attrs: Vec<(String, String)> },
    Text(String),
}

#[derive(Debug, Clone)]
pub struct Node {
    pub kind: NodeKind,
    pub children: Vec<NodeId>,
    pub parent: Option<NodeId>,
}

#[derive(Debug, Clone, Default)]
pub struct Doc {
    pub nodes: Vec<Node>,
    pub roots: Vec<NodeId>,
}

const VOID: &[&str] = &[
    "area", "base", "basefont", "br", "col", "command", "embed", "frame", "hr", "image", "img", "input", "isindex", "keygen", "link",
    "menuitem", "meta", "param", "source", "track", "wbr",
];

const RAW_TEXT: &[&str] = &["script", "style", "title", "textarea"];

fn implies_close() -> &'static HashMap<&'static str, &'static [&'static str]> {
    static MAP: OnceLock<HashMap<&'static str, &'static [&'static str]>> = OnceLock::new();
    MAP.get_or_init(|| {
        const P: &[&str] = &["p"];
        const FORM: &[&str] = &["input", "option", "optgroup", "select", "button", "datalist", "textarea"];
        let mut m: HashMap<&'static str, &'static [&'static str]> = HashMap::new();
        m.insert("tr", &["tr", "th", "td"]);
        m.insert("th", &["th"]);
        m.insert("td", &["thead", "th", "td"]);
        m.insert("body", &["head", "link", "script"]);
        m.insert("li", &["li"]);
        for t in ["p", "h1", "h2", "h3", "h4", "h5", "h6", "address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "header", "hr", "main", "menu", "nav", "ol", "pre", "section", "table", "ul"] {
            m.insert(t, P);
        }
        for t in ["select", "input", "output", "button", "datalist", "textarea"] {
            m.insert(t, FORM);
        }
        m.insert("option", &["option"]);
        m.insert("optgroup", &["optgroup", "option"]);
        m.insert("dd", &["dt", "dd"]);
        m.insert("dt", &["dt", "dd"]);
        m.insert("rt", &["rt", "rp"]);
        m.insert("rp", &["rt", "rp"]);
        m.insert("tbody", &["thead", "tbody"]);
        m.insert("tfoot", &["thead", "tbody"]);
        m
    })
}

struct Builder {
    doc: Doc,
    stack: Vec<NodeId>,
    html: bool,
}

impl Builder {
    fn append(&mut self, kind: NodeKind) -> NodeId {
        let parent = self.stack.last().copied();
        let id = self.doc.nodes.len();
        self.doc.nodes.push(Node { kind, children: Vec::new(), parent });
        match parent {
            Some(p) => self.doc.nodes[p].children.push(id),
            None => self.doc.roots.push(id),
        }
        id
    }

    fn text(&mut self, s: &str) {
        if s.is_empty() {
            return;
        }
        let parent = self.stack.last().copied();
        let siblings = match parent {
            Some(p) => &self.doc.nodes[p].children,
            None => &self.doc.roots,
        };
        if let Some(&last) = siblings.last() {
            if let NodeKind::Text(t) = &mut self.doc.nodes[last].kind {
                t.push_str(s);
                return;
            }
        }
        self.append(NodeKind::Text(s.to_string()));
    }

    fn open(&mut self, name: String, attrs: Vec<(String, String)>, self_closing: bool) {
        if self.html {
            if let Some(closes) = implies_close().get(name.as_str()) {
                while let Some(&top) = self.stack.last() {
                    let top_name = self.doc.name(top).unwrap_or("");
                    if closes.contains(&top_name) {
                        self.stack.pop();
                    } else {
                        break;
                    }
                }
            }
        }
        let is_void = self.html && VOID.contains(&name.as_str());
        let id = self.append(NodeKind::Element { name, attrs });
        if !self_closing && !is_void {
            self.stack.push(id);
        }
    }

    fn close(&mut self, name: &str) {
        if let Some(pos) = self.stack.iter().rposition(|&id| self.doc.name(id) == Some(name)) {
            self.stack.truncate(pos);
        } else if self.html && name == "p" {
            self.append(NodeKind::Element { name: "p".to_string(), attrs: Vec::new() });
        }
    }
}

fn decode_xml_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let end = tail.find(';').filter(|&e| e <= 12);
        match end {
            Some(e) => {
                let ent = &tail[1..e];
                let decoded = match ent {
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "amp" => Some('&'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    _ if ent.starts_with("#x") || ent.starts_with("#X") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
                    _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
                    _ => None,
                };
                match decoded {
                    Some(c) => {
                        out.push(c);
                        rest = &tail[e + 1..];
                    }
                    None => {
                        out.push('&');
                        rest = &tail[1..];
                    }
                }
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn decode(s: &str, html: bool) -> String {
    if html {
        html_escape::decode_html_entities(s).into_owned()
    } else {
        decode_xml_entities(s)
    }
}

fn is_name_byte(b: u8) -> bool {
    !(b.is_ascii_whitespace() || b == b'/' || b == b'>' || b == b'=')
}

fn find_from(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if from >= hay.len() {
        return None;
    }
    memchr::memmem::find(&hay[from..], needle).map(|i| i + from)
}

fn find_ci(hay: &[u8], needle_lower: &[u8], from: usize) -> Option<usize> {
    let n = needle_lower.len();
    let mut i = from;
    while i + n <= hay.len() {
        if hay[i..i + n].eq_ignore_ascii_case(needle_lower) {
            return Some(i);
        }
        i += 1;
    }
    None
}

fn parse(src: &str, html: bool) -> Doc {
    let b = src.as_bytes();
    let mut bld = Builder { doc: Doc::default(), stack: Vec::new(), html };
    let mut pos = 0;
    let n = b.len();
    while pos < n {
        let lt = match memchr::memchr(b'<', &b[pos..]) {
            Some(i) => pos + i,
            None => {
                bld.text(&decode(&src[pos..], html));
                break;
            }
        };
        if lt > pos {
            bld.text(&decode(&src[pos..lt], html));
        }
        let rest = &b[lt..];
        if rest.starts_with(b"<!--") {
            pos = find_from(b, b"-->", lt + 4).map(|i| i + 3).unwrap_or(n);
            continue;
        }
        if rest.starts_with(b"<![CDATA[") {
            let end = find_from(b, b"]]>", lt + 9).unwrap_or(n);
            bld.text(&src[lt + 9..end]);
            pos = (end + 3).min(n);
            continue;
        }
        if rest.starts_with(b"<!") || rest.starts_with(b"<?") {
            pos = memchr::memchr(b'>', rest).map(|i| lt + i + 1).unwrap_or(n);
            continue;
        }
        if rest.len() > 1 && rest[1] == b'/' {
            let mut i = lt + 2;
            while i < n && is_name_byte(b[i]) {
                i += 1;
            }
            let mut name = src[lt + 2..i].to_string();
            if html {
                name = name.to_ascii_lowercase();
            }
            pos = memchr::memchr(b'>', &b[i..]).map(|j| i + j + 1).unwrap_or(n);
            if !name.is_empty() {
                bld.close(&name);
            }
            continue;
        }
        if rest.len() > 1 && (rest[1].is_ascii_alphabetic()) {
            let mut i = lt + 1;
            while i < n && is_name_byte(b[i]) {
                i += 1;
            }
            let mut name = src[lt + 1..i].to_string();
            if html {
                name = name.to_ascii_lowercase();
            }
            let mut attrs: Vec<(String, String)> = Vec::new();
            let mut self_closing = false;
            loop {
                while i < n && b[i].is_ascii_whitespace() {
                    i += 1;
                }
                if i >= n {
                    break;
                }
                if b[i] == b'>' {
                    i += 1;
                    break;
                }
                if b[i] == b'/' {
                    if i + 1 < n && b[i + 1] == b'>' {
                        self_closing = true;
                        i += 2;
                        break;
                    }
                    i += 1;
                    continue;
                }
                let ns = i;
                while i < n && is_name_byte(b[i]) {
                    i += 1;
                }
                if i == ns {
                    i += 1;
                    continue;
                }
                let mut aname = src[ns..i].to_string();
                if html {
                    aname = aname.to_ascii_lowercase();
                }
                while i < n && b[i].is_ascii_whitespace() {
                    i += 1;
                }
                let mut value = String::new();
                if i < n && b[i] == b'=' {
                    i += 1;
                    while i < n && b[i].is_ascii_whitespace() {
                        i += 1;
                    }
                    if i < n && (b[i] == b'"' || b[i] == b'\'') {
                        let q = b[i];
                        let vs = i + 1;
                        let ve = memchr::memchr(q, &b[vs..]).map(|j| vs + j).unwrap_or(n);
                        value = decode(&src[vs..ve], html);
                        i = (ve + 1).min(n);
                    } else {
                        let vs = i;
                        while i < n && !b[i].is_ascii_whitespace() && b[i] != b'>' {
                            i += 1;
                        }
                        let mut ve = i;
                        if ve > vs && b[ve - 1] == b'/' && i < n && b[i] == b'>' {
                            ve -= 1;
                            i -= 1;
                        }
                        value = decode(&src[vs..ve], html);
                    }
                }
                attrs.push((aname, value));
            }
            pos = i;
            let raw = html && RAW_TEXT.contains(&name.as_str()) && !self_closing;
            bld.open(name.clone(), attrs, self_closing);
            if raw {
                let close = format!("</{name}");
                let end = find_ci(b, close.as_bytes(), pos).unwrap_or(n);
                let content = &src[pos..end];
                let text = if name == "title" || name == "textarea" { decode(content, true) } else { content.to_string() };
                bld.text(&text);
                pos = memchr::memchr(b'>', &b[end..]).map(|j| end + j + 1).unwrap_or(n);
                bld.close(&name);
            }
            continue;
        }
        bld.text("<");
        pos = lt + 1;
    }
    bld.doc
}

impl Doc {
    /// HTML: lower-cased names, entities decoded, self-closing tags honoured.
    pub fn parse_html(src: &str) -> Doc {
        parse(src, true)
    }

    /// XML (OPF, NCX, DOCX parts): names keep their case; only XML entities are decoded.
    pub fn parse_xml(src: &str) -> Doc {
        parse(src, false)
    }

    pub fn name(&self, id: NodeId) -> Option<&str> {
        match &self.nodes[id].kind {
            NodeKind::Element { name, .. } => Some(name.as_str()),
            _ => None,
        }
    }

    pub fn is_element(&self, id: NodeId) -> bool {
        matches!(self.nodes[id].kind, NodeKind::Element { .. })
    }

    pub fn text(&self, id: NodeId) -> Option<&str> {
        match &self.nodes[id].kind {
            NodeKind::Text(t) => Some(t.as_str()),
            _ => None,
        }
    }

    pub fn attr(&self, id: NodeId, name: &str) -> Option<&str> {
        match &self.nodes[id].kind {
            NodeKind::Element { attrs, .. } => attrs.iter().rev().find(|(k, _)| k == name).map(|(_, v)| v.as_str()),
            _ => None,
        }
    }

    pub fn has_attr(&self, id: NodeId, name: &str) -> bool {
        self.attr(id, name).is_some()
    }

    pub fn attrs(&self, id: NodeId) -> &[(String, String)] {
        match &self.nodes[id].kind {
            NodeKind::Element { attrs, .. } => attrs,
            _ => &[],
        }
    }

    pub fn set_attr(&mut self, id: NodeId, name: &str, value: &str) {
        if let NodeKind::Element { attrs, .. } = &mut self.nodes[id].kind {
            attrs.push((name.to_string(), value.to_string()));
        }
    }

    pub fn children(&self, id: NodeId) -> &[NodeId] {
        &self.nodes[id].children
    }

    pub fn parent(&self, id: NodeId) -> Option<NodeId> {
        self.nodes[id].parent
    }

    /// All text under a node, nothing skipped.
    pub fn raw_text(&self, id: NodeId) -> String {
        let mut s = String::new();
        self.collect_text(id, &mut s, &|_| false);
        s
    }

    pub fn collect_text(&self, id: NodeId, out: &mut String, skip: &dyn Fn(&str) -> bool) {
        match &self.nodes[id].kind {
            NodeKind::Text(t) => out.push_str(t),
            NodeKind::Element { name, .. } => {
                if skip(name) {
                    return;
                }
                for &c in &self.nodes[id].children {
                    self.collect_text(c, out, skip);
                }
            }
        }
    }

    /// Elements in document order matching `pred`, over the whole document.
    pub fn find_all(&self, pred: &dyn Fn(&Doc, NodeId) -> bool) -> Vec<NodeId> {
        let mut out = Vec::new();
        for &r in &self.roots {
            self.find_under_into(r, pred, &mut out);
        }
        out
    }

    pub fn find_under(&self, id: NodeId, pred: &dyn Fn(&Doc, NodeId) -> bool) -> Vec<NodeId> {
        let mut out = Vec::new();
        self.find_under_into(id, pred, &mut out);
        out
    }

    fn find_under_into(&self, id: NodeId, pred: &dyn Fn(&Doc, NodeId) -> bool, out: &mut Vec<NodeId>) {
        if self.is_element(id) && pred(self, id) {
            out.push(id);
        }
        for &c in &self.nodes[id].children {
            self.find_under_into(c, pred, out);
        }
    }

    /// Elements under `id` (not `id` itself) matching `pred`, depth first.
    pub fn descendants(&self, id: NodeId, pred: &dyn Fn(&Doc, NodeId) -> bool) -> Vec<NodeId> {
        let mut out = Vec::new();
        for &c in &self.nodes[id].children {
            self.find_under_into(c, pred, &mut out);
        }
        out
    }

    /// The element's name without a namespace prefix, lower-cased ("epub:switch" → "switch").
    pub fn local_name(&self, id: NodeId) -> String {
        let n = self.name(id).unwrap_or("");
        let n = match n.rfind(':') {
            Some(i) => &n[i + 1..],
            None => n,
        };
        n.to_ascii_lowercase()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_tree_with_implied_closes_and_self_closing_tags() {
        let d = Doc::parse_html("<p>One<p>Two<br>three <a id=\"x\"/> four &amp; &#160;five<img src=a.png>");
        let ps = d.find_all(&|d, id| d.name(id) == Some("p"));
        assert_eq!(ps.len(), 2);
        assert_eq!(d.raw_text(ps[0]), "One");
        assert_eq!(d.raw_text(ps[1]), "Twothree  four & \u{a0}five");
        let a = d.find_all(&|d, id| d.name(id) == Some("a"));
        assert_eq!(d.children(a[0]).len(), 0);
        assert_eq!(d.attr(a[0], "id"), Some("x"));
    }

    #[test]
    fn xml_mode_keeps_case_and_decodes_only_xml_entities() {
        let d = Doc::parse_xml("<?xml version=\"1.0\"?><opf:package unique-identifier=\"id\"><dc:title>A &amp; B &nbsp;</dc:title></opf:package>");
        let t = d.find_all(&|d, id| d.local_name(id) == "title");
        assert_eq!(d.raw_text(t[0]), "A & B &nbsp;");
        assert_eq!(d.name(d.roots[0]), Some("opf:package"));
        assert_eq!(d.attr(d.roots[0], "unique-identifier"), Some("id"));
    }

    #[test]
    fn script_and_comments_are_handled() {
        let d = Doc::parse_html("<div><!-- hidden --><script>if (a < b) x()</script><p>after</p></div>");
        let s = d.find_all(&|d, id| d.name(id) == Some("script"));
        assert_eq!(d.raw_text(s[0]), "if (a < b) x()");
        let p = d.find_all(&|d, id| d.name(id) == Some("p"));
        assert_eq!(d.raw_text(p[0]), "after");
    }
}
