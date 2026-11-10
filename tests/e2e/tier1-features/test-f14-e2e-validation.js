/**
 * Tier 1 - Feature 14: E2E Test Suite Validation & Hardening
 * Verifies that the E2E test harness, assertions, probe validators,
 * and fixture generators execute reliably and accurately detect discrepancies.
 */

const { assertTrue, assertFalse, assertEquals, assertRejects } = require('../helpers/assertions');
const {
  isFaststart,
  parseMp4Atoms,
  readId3Header,
  assertPremiereProCompatible,
  assertStandaloneMp3Compatible,
} = require('../helpers/media-probe');
const {
  generateH264Mp4,
  generate4KVp9Webm,
  generateMp3,
} = require('../helpers/media-generator');

module.exports = {
  name: 'Feature 14: E2E Test Suite Validation & Hardening',
  tests: [
    {
      name: 'F14.1: Test harness assertion library throws TestFailure on mismatched equality',
      run: async () => {
        let threw = false;
        try {
          assertEquals('apple', 'banana');
        } catch (err) {
          threw = true;
          assertEquals(err.name, 'TestFailure');
        }
        assertTrue(threw, 'assertEquals should throw TestFailure on mismatch');
      }
    },
    {
      name: 'F14.2: MP4 atom parser accurately detects whether moov atom precedes mdat',
      run: async () => {
        // Faststart file: moov is before mdat
        const fastMp4 = generateH264Mp4({ faststart: true });
        assertTrue(isFaststart(fastMp4), 'faststart=true file must be detected as faststart');

        // Non-faststart file: moov is after mdat
        const normalMp4 = generateH264Mp4({ faststart: false });
        assertFalse(isFaststart(normalMp4), 'faststart=false file must not be detected as faststart');
      }
    },
    {
      name: 'F14.3: Premiere Pro validator rejects non-H.264 formats (VP9 WebM)',
      run: async () => {
        const vp9File = generate4KVp9Webm();
        await assertRejects(async () => {
          assertPremiereProCompatible(vp9File);
        }, 'Premiere validator must reject VP9 WebM');
      }
    },
    {
      name: 'F14.4: Universal MP3 validator rejects ID3v2.4 files',
      run: async () => {
        const v4File = generateMp3({ id3Version: 4 });
        await assertRejects(async () => {
          assertStandaloneMp3Compatible(v4File);
        }, 'Universal MP3 validator must reject ID3v2.4');
      }
    },
    {
      name: 'F14.5: Media generator fixtures pass their respective compatibility contracts',
      run: async () => {
        const compliantMp4 = generateH264Mp4({ width: 1920, height: 1080, sampleRate: 48000, faststart: true });
        const resMp4 = assertPremiereProCompatible(compliantMp4);
        assertTrue(!!resMp4.vstream && !!resMp4.astream);

        const compliantMp3 = generateMp3({ bitrate: '320k', sampleRate: 44100, id3Version: 3 });
        const resMp3 = assertStandaloneMp3Compatible(compliantMp3);
        assertTrue(!!resMp3.astream && resMp3.id3.version === 3);
      }
    }
  ]
};
