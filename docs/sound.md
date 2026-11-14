# Sound (Design video)

A Design video can have a voice that tells the story scene by scene and, if you like, music under it. worca's server
makes both with ElevenLabs; agents never see the key. Every other kind of design, and a video whose sound is off,
stays as it is.

## The two cards

When the first build of a video is about to start, its chat shows the card **Sound for this video**: **Yes** or
**No**, plus the **ElevenLabs API key** field when no key is saved. **No** starts the build silent. **Yes** checks
the key by listing your account's voices, then shows **Voice and music**: up to six voices, each with a sample to play, and
**Background music?** (**No music**, **Calm**, **Upbeat**, **Cinematic**, **Playful** or **Something else**, which
you describe). **Start** starts the build. A message typed instead of an answer closes the card as *Not answered*,
and the video stays silent.

Later, the **Sound** row in the composer's settings shows the pick, and its **Change** opens the cards again (with
**Save**) to change the voice or the music, or to turn sound off. The next round applies it.

## The key

Providers › **Sound (Design)** shows the key, *Test* checks it (*Key works · n voices*), and *Save* stores it; empty
the field and *Save* to remove it. A key that works when typed in the card is saved the same way. It sits in worca's
settings on this machine (`settings.json` in your home folder, under `providers.sound`; see [Storage](storage.md)):
a literal, shown masked, or a `${VAR}` that worca reads from its own environment, shown as written. It goes only to
ElevenLabs, never to the browser, an agent or the chat model.

## What ElevenLabs is asked for, and the price

- **Voices:** your account's own voices (its default ones too) that have a sample; up to six are offered.
- **Voice:** one clip per scene that has words, with the time of each word (`eleven_multilingual_v2`). The lead
  writes each scene's words, and worca makes a scene longer when its voice needs it. A change round makes again
  only the clips whose words changed.
- **Music:** one instrumental track for the film (`music_v2_5`), at most five minutes; a longer film loops it.

Each clip and track is booked to its round at list prices: `$0.08` per 1,000 characters of voice and `$0.15` per
minute of music. That is not your ElevenLabs bill: a subscription pays from its credits. It counts toward worca's
cost limits as an agent's dollars do, and a round that reaches one pauses. A failed call costs nothing.

A sound failure never fails a build: the film is built with the sound that exists, the chat says why
(`Sound: <reason>`), and the next round tries again what is missing.

## The files and the exports

`work/assets/sound/` holds `voice-<sectionId>.<ext>` per scene, `music.<ext>` and `sound.json`, which lists them
(`<ext>` is `mp3`, or `wav` in mock mode). They travel like every file under `assets/`: versions, the zip and
**Copy into a project**. The **Standalone HTML** export carries them too. The preview plays them with the film,
with a **Mute** button after the play button (kept per browser). Opened on its own, a film with sound starts when
you click it or press Space. The **Video (MP4)** export mixes them into its sound. No music without a voice.

## Credential broker and hosted

With the [credential broker](credential-broker.md) on, worca stores no sound key: *Save* on the row refuses one,
worca will not start while an old `providers.sound.apiKey` is left in the settings file, the chat shows no sound
card, a video starts silent, and the composer's settings have no **Sound** row. On a hosted worca one key serves
the whole server: whoever starts the first video with no key saved is asked for it.

## Mock mode

With `WORCA_MOCK=1` no call is made: six built-in voices, silent WAV files, and the same prices booked. Any key is
accepted.
