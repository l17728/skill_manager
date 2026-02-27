'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Read a JSON file and parse it. Returns null if file does not exist.
 */
function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

/**
 * Write data as formatted JSON to a file. Creates parent dirs as needed.
 */
function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * Read a text file. Returns null if file does not exist.
 */
function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

/**
 * Write text to a file.
 */
function writeText(filePath, content) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, content, 'utf-8')
}

/**
 * Ensure a directory exists (create recursively if needed).
 */
function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

/**
 * List immediate subdirectory names under a directory.
 * Returns empty array if directory does not exist.
 */
function listDirs(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

/**
 * List immediate file names under a directory.
 * Returns empty array if directory does not exist.
 */
function listFiles(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(d => d.isFile())
      .map(d => d.name)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

/**
 * Copy a directory recursively.
 */
function copyDir(src, dest) {
  ensureDir(dest)
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Check if a path exists.
 */
function exists(p) {
  return fs.existsSync(p)
}

/**
 * Remove a directory recursively.
 */
function removeDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true })
}

module.exports = {
  readJson,
  writeJson,
  readText,
  writeText,
  ensureDir,
  listDirs,
  listFiles,
  copyDir,
  exists,
  removeDir,
}
