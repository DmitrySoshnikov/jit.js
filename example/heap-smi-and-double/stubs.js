var jit = require('jit.js');
var Buffer = require('buffer').Buffer;

var utils = require('./utils');
var stubs = jit.stubs();

// Create fixed size memory chunk
var page = new Buffer(1024);

// Set-up pointers to page start and page end
var offset = jit.ptr(page);
var end = jit.ptr(page, page.length);

stubs.define('Alloc', function(size, tag) {
  // Save 'rbx' and 'rcx' registers
  this.spill(['rbx', 'rcx'], function() {
    // Load `offset`
    //
    // NOTE: We'll use pointer to `offset` variable, to be able to update
    // it below
    this.mov('rax', this.ptr(offset));
    this.mov('rax', ['rax']);

    // Load end
    //
    // NOTE: Same applies to end, though, we're not updating it right now
    this.mov('rbx', this.ptr(end));
    this.mov('rbx', ['rbx']);

    // Calculate new `offset`
    this.mov('rcx', 'rax');

    // Add tag size and body size
    this.add('rcx', 8);
    this.add('rcx', size);

    // Check if we won't overflow our fixed size buffer
    this.cmp('rcx', 'rbx');

    // this.j() performs conditional jump to the specified label.
    // 'g' stands for 'greater'
    // 'overflow' is a label name, bound below
    this.j('g', 'overflow');

    // Ok, we're good to go, update offset
    this.mov('rbx', this.ptr(offset));
    this.mov(['rbx'], 'rcx');

    // First 64bit pointer is reserved for 'tag', second one is a `double` value
    this.mov('rcx', tag);
    this.mov(['rax'], 'rcx');

    // Tag pointer
    this.sub('rax', 1);

    // Return 'rax'
    this.Return();

    // Overflowed :(
    this.bind('overflow')

    // Invoke javascript function!
    // NOTE: This is really funky stuff, but I'm not going to dive deep
    // into it right now
    this.runtime(function() {
      console.log('GC is needed, but not implemented');
    });

    // Crash
    this.int3();

    this.Return();
  });
});

var operators = ['+', '-', '*', '/'];
operators.forEach(function(operator) {
  stubs.define('Binary' + operator, function(left, right) {
    // Load some helper methods
    this.checkSmi = utils.checkSmi;
    this.untagSmi = utils.untagSmi;
    this.heapOffset = utils.heapOffset;
    this.untagSmi = utils.untagSmi;

    this.spill(['rbx', 'rcx'], function() {
      // Load arguments to rax and rbx
      this.mov('rax', left);
      this.mov('rbx', right);

      // Convert both numbers to doubles
      [['rax', 'xmm1'], ['rbx', 'xmm2']].forEach(function(regs) {
        this.labelScope(function() {
          this.checkSmi(regs[0]);
          this.j('ne', 'non-smi');

          // Convert integer to double
          this.untagSmi(regs[0]);
          this.cvtsi2sd(regs[1], regs[0]);

          this.j('done');
          this.bind('non-smi');

          this.movq(regs[1], this.heapOffset(regs[0], 0));
          this.bind('done');
        });
      }, this);

      // Execute binary operation
      if (operator === '+')
        this.addsd('xmm1', 'xmm2');
      else if (operator === '-')
        this.subsd('xmm1', 'xmm2');
      else if (operator === '*')
        this.mulsd('xmm1', 'xmm2');
      else if (operator === '/')
        this.divsd('xmm1', 'xmm2');
      else
        throw new Error('Unsupported binary operator: ' + ast.operator);

      // Allocate new number, and put value in it
      this.stub('rax', 'Alloc', 8, 1);
      this.movq(this.heapOffset('rax', 0), 'xmm1');
    });

    this.Return();
  });
});

module.exports = stubs;
