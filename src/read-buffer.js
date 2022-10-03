module.exports = { ReadBuffer }

/**
 * @param {Buffer} buffer 
 * @param {number} [offset]
 */
function ReadBuffer(buffer, offset) {
  /** @protected */
  this._buf = typeof offset === 'number'
    ? buffer.subarray(offset, buffer.length)
    : buffer;
  /** @protected */
  this._readOffset = 0;
}
Object.defineProperty(ReadBuffer.prototype, 'buffer', {
  get: function () {
    return this._buf;
  },
  enumerable: true,
  configurable: true,
})
Object.defineProperty(ReadBuffer.prototype, 'position', {
  get: function () {
    return this._readOffset;
  },
  enumerable: true,
  configurable: true,
})
Object.defineProperty(ReadBuffer.prototype, 'length', {
  get: function () {
    return this._buf.length;
  },
  enumerable: true,
  configurable: true,
})

/** @param {number} byteOffset */
ReadBuffer.prototype.seek = function seek(byteOffset) {
  this._readOffset += byteOffset;
  return this._readOffset;
}

/** @param {number} [offset] */
ReadBuffer.prototype.readUInt16BE = function readUInt16BE(offset) {
  return this._readNumberValue(this._buf.readUInt16BE, 2, offset)
}
/** @type {ReadBuffer['readUInt16BE']} */
ReadBuffer.prototype.readUint16BE = ReadBuffer.prototype.readUInt16BE;
/** @param {number} [offset] */
ReadBuffer.prototype.readUInt8 = function readUInt8(offset) {
  return this._readNumberValue(this._buf.readUInt8, 1, offset)
}

/**
 * @protected
 * @template T
 * @param {Extract<T, (offset: number) => any>} fn 
 * @param {number} byteSize
 * @param {number} [offset]
 * @return {ReturnType<T>}
 */
ReadBuffer.prototype._readNumberValue = function _readNumberValue(fn, byteSize, offset) {
  if (typeof offset === 'number') {
    return fn.call(this._buf, offset)
  }
  const value = fn.call(this._buf, this._readOffset)
  this._readOffset += byteSize;
  return value;
}

/**
 * @param {BufferEncoding} encoding 
 */
ReadBuffer.prototype.readStringNT = function readStringNT(encoding) {
  let nullPos = this._buf.length;
  for (let i = this._readOffset; i < this._buf.length; ++i) {
    if (this._buf[i] === 0x00) {
      nullPos = i;
      break;
    }
  }
  const value = this._buf.subarray(this._readOffset, this._readOffset + nullPos)
  this._readOffset = nullPos + 1;
  return value.toString(encoding)
}

/**
 * @param {number} byteSize
 * @param {number} [offset]
 */
ReadBuffer.prototype.readArrayBuffer = function readArrayBuffer(byteSize, offset) {
  if (typeof offset === 'number') {
    return this._buf.subarray(offset, offset + byteSize)
  }
  const value = this._buf.subarray(this._readOffset, this._readOffset + byteSize)
  this._readOffset += byteSize;
  return value;
}
