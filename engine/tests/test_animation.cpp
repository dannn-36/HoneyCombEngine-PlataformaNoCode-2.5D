// Pruebas de AnimationSystem y AnimationInstance: el catalogo de clips y el
// avance de cuadros con el tiempo.

#include "doctest/doctest.h"

#include <stdexcept>

#include "systems/animation/AnimationSystem.hpp"

namespace {

AnimationClip Clip(int frames, float duration, bool loop) {
    AnimationClip clip;
    for (int i = 0; i < frames; ++i) {
        clip.frames.push_back(Rectangle{static_cast<float>(i * 16), 0, 16, 16});
    }
    clip.frameDuration = duration;
    clip.loop = loop;
    return clip;
}

}  // namespace

TEST_SUITE("animaciones") {

TEST_CASE("un clip registrado se recupera por nombre") {
    AnimationSystem animations;
    animations.RegisterClip("caminar", Clip(4, 0.1f, true));
    CHECK(animations.GetClip("caminar").frames.size() == 4);
}

TEST_CASE("pedir un clip que no existe falla con una excepcion") {
    AnimationSystem animations;
    CHECK_THROWS_AS(animations.GetClip("no_existe"), std::out_of_range);
}

TEST_CASE("sin clip el cuadro actual es vacio") {
    AnimationInstance instance;
    instance.Update(1.0f);
    const Rectangle frame = instance.GetCurrentFrame();
    CHECK(frame.width == doctest::Approx(0.0f));
    CHECK_FALSE(instance.IsFinished());
}

TEST_CASE("el cuadro avanza cuando pasa su duracion") {
    const AnimationClip clip = Clip(3, 0.1f, true);
    AnimationInstance instance;
    instance.Play(clip);
    CHECK(instance.GetCurrentFrame().x == doctest::Approx(0.0f));
    instance.Update(0.05f);
    CHECK(instance.GetCurrentFrame().x == doctest::Approx(0.0f));
    instance.Update(0.06f);
    CHECK(instance.GetCurrentFrame().x == doctest::Approx(16.0f));
}

TEST_CASE("un frame largo avanza varios cuadros de una vez") {
    const AnimationClip clip = Clip(5, 0.1f, true);
    AnimationInstance instance;
    instance.Play(clip);
    instance.Update(0.35f);
    CHECK(instance.GetCurrentFrame().x == doctest::Approx(48.0f));
}

TEST_CASE("un clip en loop vuelve al primer cuadro") {
    const AnimationClip clip = Clip(2, 0.1f, true);
    AnimationInstance instance;
    instance.Play(clip);
    instance.Update(0.25f);
    CHECK(instance.GetCurrentFrame().x == doctest::Approx(0.0f));
    CHECK_FALSE(instance.IsFinished());
}

TEST_CASE("un clip sin loop se queda en el ultimo cuadro y termina") {
    const AnimationClip clip = Clip(3, 0.1f, false);
    AnimationInstance instance;
    instance.Play(clip);
    instance.Update(1.0f);
    CHECK(instance.GetCurrentFrame().x == doctest::Approx(32.0f));
    CHECK(instance.IsFinished());
    instance.Update(1.0f);
    CHECK(instance.GetCurrentFrame().x == doctest::Approx(32.0f));
}

TEST_CASE("pedir el mismo clip no lo reinicia salvo que se pida") {
    const AnimationClip clip = Clip(3, 0.1f, true);
    AnimationInstance instance;
    instance.Play(clip);
    instance.Update(0.15f);
    instance.Play(clip);
    CHECK(instance.GetCurrentFrame().x == doctest::Approx(16.0f));
    instance.Play(clip, true);
    CHECK(instance.GetCurrentFrame().x == doctest::Approx(0.0f));
}

TEST_CASE("cambiar de clip arranca el nuevo desde el principio") {
    const AnimationClip walk = Clip(3, 0.1f, true);
    const AnimationClip idle = Clip(2, 0.5f, false);
    AnimationInstance instance;
    instance.Play(walk);
    instance.Update(0.15f);
    instance.Play(idle);
    CHECK(instance.GetCurrentFrame().x == doctest::Approx(0.0f));
    CHECK_FALSE(instance.IsFinished());
}

TEST_CASE("un clip sin cuadros no avanza ni se rompe") {
    const AnimationClip empty = Clip(0, 0.1f, true);
    AnimationInstance instance;
    instance.Play(empty);
    CHECK_NOTHROW(instance.Update(1.0f));
    CHECK(instance.GetCurrentFrame().width == doctest::Approx(0.0f));
}

}  // TEST_SUITE
