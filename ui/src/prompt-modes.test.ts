import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { currentMode, promptModes } from './prompt-modes.ts';

const made = { frame: 'Hero', iteration: 'iteration-02', made: true };

describe("the canvas prompt's modes", () => {
  it('offers New in a component, and Fork and Refine on a made iteration', () => {
    assert.deepEqual(
      promptModes(made).map(mode => [mode.id, mode.label, mode.disabled]),
      [
        ['new', 'New', false],
        ['fork', 'Fork', false],
        ['refine', 'Refine', false]
      ]
    );
    assert.equal(promptModes(made)[0]!.placeholder, 'Directions for Hero, one per line');
    assert.equal(
      promptModes(made)[1]!.placeholder,
      'What should change in a fork of iteration-02; a Keep: line says what stays'
    );
    assert.equal(promptModes(made)[2]!.placeholder, 'How to refine iteration-02');
  });

  it('says what to select when nothing fits', () => {
    const none = promptModes({ frame: null, iteration: null, made: false });
    assert.deepEqual(
      none.map(mode => [mode.id, mode.disabled, mode.placeholder]),
      [
        ['new', true, 'Select a component to start iterations in it'],
        ['fork', true, 'Select an iteration to fork it'],
        ['refine', true, 'Select an iteration to refine it']
      ]
    );
  });

  it('lets the selection decide with Complete features off', () => {
    const onSketch = promptModes({ ...made, complete: false });
    assert.deepEqual(
      onSketch.map(mode => [mode.id, mode.disabled, mode.placeholder]),
      [['fork', false, 'What should change in iteration-02']]
    );
    const inComponent = promptModes({ ...made, iteration: null, made: false, complete: false });
    assert.deepEqual(
      inComponent.map(mode => mode.id),
      ['new']
    );
    // On, or not known (an older studio server): as they were.
    assert.equal(promptModes({ ...made, complete: true })[1]!.disabled, false);
    assert.equal(promptModes(made)[1]!.completeOnly, true);
  });

  it('falls back to New when the asked mode cannot be used', () => {
    assert.equal(currentMode(promptModes(made), 'fork'), 'fork');
    assert.equal(currentMode(promptModes({ ...made, complete: false }), 'new'), 'fork');
    assert.equal(currentMode(promptModes(made), 'sideways'), 'new');
  });
});
