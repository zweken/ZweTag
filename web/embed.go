// Package web holds the ZweTag interface: index.html, the ES modules and the
// stylesheet under assets/, and the icons under brand/. The desktop app
// serves it from memory; the same folder is published as a static site.
package web

import "embed"

// FS is the interface, rooted at this folder.
//
//go:embed index.html assets brand
var FS embed.FS
