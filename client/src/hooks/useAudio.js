import { useEffect, useRef, useState, useCallback } from 'react';

export function useAudio() {
  const [isMuted, setIsMuted] = useState(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const synthsRef = useRef(null);
  const bgMusicPattern = useRef(null);
  const isInitialized = useRef(false);
  const ToneRef = useRef(null);

  useEffect(() => {
    const initTone = async () => {
      if (isInitialized.current) return;
      isInitialized.current = true;
      try {
        const Tone = await import('tone');
        ToneRef.current = Tone;
        await Tone.start();

        const reverb = new Tone.Reverb({ decay: 5, wet: 0.6 }).toDestination();
        const delay = new Tone.FeedbackDelay('8n', 0.4).connect(reverb);

        const padSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: { attack: 2, decay: 1, sustain: 1, release: 5 }
        }).connect(reverb);

        const popSynth = new Tone.MembraneSynth({
          pitchDecay: 0.05,
          octaves: 2,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 }
        }).toDestination();

        const goodSynth = new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 2,
          modulationIndex: 3,
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.02, decay: 0.3, sustain: 0.2, release: 1.5 }
        }).connect(delay);

        const badSynth = new Tone.PolySynth(Tone.AMSynth, {
          harmonicity: 0.5,
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 1.5 }
        }).connect(delay);

        // Fanfare synth — bright trumpet-like
        const fanfareSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.5 }
        }).connect(reverb);
        fanfareSynth.volume.value = -6;

        // Dice synth — noise-based rattle
        const noiseSynth = new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 }
        }).toDestination();
        noiseSynth.volume.value = -12;

        // Coin collect synth — bright metallic ping
        const coinSynth = new Tone.MetalSynth({
          frequency: 300,
          envelope: { attack: 0.001, decay: 0.4, release: 0.3 },
          harmonicity: 5.1,
          modulationIndex: 16,
          octaves: 1.5,
        }).toDestination();
        coinSynth.volume.value = -8;

        synthsRef.current = { padSynth, popSynth, goodSynth, badSynth, fanfareSynth, noiseSynth, coinSynth };

        bgMusicPattern.current = new Tone.Pattern((time, note) => {
          if (synthsRef.current) synthsRef.current.padSynth.triggerAttackRelease(note, '1m', time, 0.2);
        }, ['C3', 'G3', 'D4', 'A3', 'E4', 'C4'], 'randomWalk');
        bgMusicPattern.current.interval = '1m';
      } catch (e) { console.error('Tone init error', e); }
    };

    document.addEventListener('click', initTone, { once: true });
    return () => {
      document.removeEventListener('click', initTone);
      if (bgMusicPattern.current) { bgMusicPattern.current.stop(); bgMusicPattern.current.dispose(); }
      if (synthsRef.current) {
        Object.values(synthsRef.current).forEach(s => s.dispose && s.dispose());
      }
    };
  }, []);

  const playPopSound = useCallback(() => {
    if (isMuted || !synthsRef.current) return;
    try { synthsRef.current.popSynth.triggerAttackRelease('C4', '8n'); } catch (e) {}
  }, [isMuted]);

  const playCaptureSound = useCallback((byMe) => {
    if (isMuted || !synthsRef.current) return;
    try {
      if (byMe) {
        synthsRef.current.goodSynth.triggerAttackRelease(['C5', 'E5', 'G5'], '2n');
      } else {
        synthsRef.current.badSynth.triggerAttackRelease(['C2', 'Eb2'], '2n');
      }
    } catch (e) {}
  }, [isMuted]);

  // Victory fanfare: ascending triumphal chord sequence
  const playVictoryFanfare = useCallback(() => {
    if (isMuted || !synthsRef.current || !ToneRef.current) return;
    try {
      const Tone = ToneRef.current;
      const { fanfareSynth } = synthsRef.current;
      const now = Tone.now();
      const seq = [
        { notes: ['C4', 'E4', 'G4'], t: 0,   dur: '4n' },
        { notes: ['C4', 'E4', 'G4'], t: 0.35, dur: '4n' },
        { notes: ['C4', 'E4', 'G4'], t: 0.7,  dur: '4n' },
        { notes: ['C4', 'E4', 'G4', 'C5'], t: 1.1, dur: '2n' },
        { notes: ['G4', 'B4', 'D5', 'G5'], t: 1.9, dur: '1n' },
      ];
      seq.forEach(({ notes, t, dur }) => {
        fanfareSynth.triggerAttackRelease(notes, dur, now + t, 0.8);
      });
    } catch (e) {}
  }, [isMuted]);

  // Dice rolling sound: rapid noise bursts
  const playDiceRollSound = useCallback(() => {
    if (isMuted || !synthsRef.current || !ToneRef.current) return;
    try {
      const Tone = ToneRef.current;
      const { noiseSynth } = synthsRef.current;
      const now = Tone.now();
      // Accelerating clicks simulating dice tumbling
      [0, 0.12, 0.22, 0.30, 0.37, 0.43, 0.48, 0.52, 0.55, 0.57].forEach(t => {
        noiseSynth.triggerAttackRelease('8n', now + t, 0.6);
      });
    } catch (e) {}
  }, [isMuted]);

  // Short reveal ding when dice settle
  const playDiceRevealSound = useCallback(() => {
    if (isMuted || !synthsRef.current || !ToneRef.current) return;
    try {
      const Tone = ToneRef.current;
      const { goodSynth } = synthsRef.current;
      const now = Tone.now();
      goodSynth.triggerAttackRelease(['E5', 'G5', 'B5'], '4n', now, 0.5);
    } catch (e) {}
  }, [isMuted]);

  useEffect(() => {
    if (isMusicPlaying && !isMuted) {
      const Tone = ToneRef.current;
      if (Tone && Tone.Transport.state !== 'started') Tone.Transport.start();
      bgMusicPattern.current?.start(0);
    } else {
      bgMusicPattern.current?.stop();
      synthsRef.current?.padSynth?.releaseAll();
    }
  }, [isMusicPlaying, isMuted]);

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (!isMuted) setIsMusicPlaying(false);
  };

  const toggleMusic = () => {
    if (isMuted && !isMusicPlaying) setIsMuted(false);
    setIsMusicPlaying(!isMusicPlaying);
  };

  // Coin collect sound: bright ascending ping
  const playCoinSound = useCallback(() => {
    if (isMuted || !synthsRef.current || !ToneRef.current) return;
    try {
      const Tone = ToneRef.current;
      const { coinSynth } = synthsRef.current;
      const now = Tone.now();
      coinSynth.triggerAttackRelease('16n', now, 0.8);
      coinSynth.triggerAttackRelease('16n', now + 0.15, 0.5);
    } catch (e) {}
  }, [isMuted]);

  return {
    playPopSound, playCaptureSound, playVictoryFanfare,
    playDiceRollSound, playDiceRevealSound, playCoinSound,
    isMuted, toggleMute, isMusicPlaying, toggleMusic
  };
}
