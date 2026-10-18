// Pruebas de EventSystem: el motor "cuando pase X, si se cumple Y, hacer Z".
// Las reglas que se prueban son las del .hpp: un evento ejecuta sus acciones
// una vez, en el frame en que PASA a cumplirse, y un type sin registrar se
// ignora sin romper el nivel.

#include "doctest/doctest.h"

#include <string>
#include <vector>

#include "nlohmann/json.hpp"

#include "systems/event_system/EventSystem.hpp"

using nlohmann::json;

namespace {

EventStep Step(const std::string& type, json params = json::object()) {
    return EventStep{type, std::move(params)};
}

EventDefinition Event(EventStep trigger, std::vector<EventStep> conditions, std::vector<EventStep> actions) {
    return EventDefinition{std::move(trigger), std::move(conditions), std::move(actions)};
}

// Un sistema con un trigger que lee "armed" y una accion que anota su nombre.
struct EventFixture {
    EventSystem events;
    bool armed = false;
    std::vector<std::string> log;

    EventFixture() {
        events.RegisterTrigger("armado", [this](const json&) { return armed; });
        events.RegisterTrigger("nunca", [](const json&) { return false; });
        events.RegisterCondition("si", [](const json&) { return true; });
        events.RegisterCondition("no", [](const json&) { return false; });
        events.RegisterAction("anotar", [this](const json& params) {
            log.push_back(params.value("nombre", std::string("?")));
        });
    }

    void Load(std::vector<EventDefinition> definitions) { events.LoadEvents(std::move(definitions)); }
};

EventStep Note(const std::string& name) {
    return Step("anotar", {{"nombre", name}});
}

}  // namespace

TEST_SUITE("sistema de eventos") {

TEST_CASE("sin eventos cargados actualizar no hace nada") {
    EventSystem events;
    CHECK_NOTHROW(events.Update());
}

TEST_CASE("un evento ejecuta sus acciones solo en el frame en que empieza a cumplirse") {
    EventFixture fx;
    fx.Load({Event(Step("armado"), {}, {Note("a")})});

    fx.events.Update();
    CHECK(fx.log.empty());

    fx.armed = true;
    fx.events.Update();
    fx.events.Update();
    fx.events.Update();
    CHECK(fx.log.size() == 1);
}

TEST_CASE("un evento vuelve a dispararse despues de dejar de cumplirse") {
    EventFixture fx;
    fx.Load({Event(Step("armado"), {}, {Note("a")})});
    fx.armed = true;
    fx.events.Update();
    fx.armed = false;
    fx.events.Update();
    fx.armed = true;
    fx.events.Update();
    CHECK(fx.log.size() == 2);
}

TEST_CASE("todas las condiciones tienen que cumplirse") {
    EventFixture fx;
    fx.armed = true;
    fx.Load({
        Event(Step("armado"), {Step("si"), Step("si")}, {Note("todas")}),
        Event(Step("armado"), {Step("si"), Step("no")}, {Note("una_falla")}),
    });
    fx.events.Update();
    REQUIRE(fx.log.size() == 1);
    CHECK(fx.log[0] == "todas");
}

TEST_CASE("un evento cuyo trigger no dispara no ejecuta nada") {
    EventFixture fx;
    fx.Load({Event(Step("nunca"), {Step("si")}, {Note("a")})});
    fx.events.Update();
    CHECK(fx.log.empty());
}

TEST_CASE("un trigger sin registrar se ignora sin romper") {
    EventFixture fx;
    fx.armed = true;
    fx.Load({
        Event(Step("bloque_del_futuro"), {}, {Note("desconocido")}),
        Event(Step("armado"), {}, {Note("conocido")}),
    });
    CHECK_NOTHROW(fx.events.Update());
    REQUIRE(fx.log.size() == 1);
    CHECK(fx.log[0] == "conocido");
}

TEST_CASE("una condicion sin registrar cuenta como no cumplida") {
    EventFixture fx;
    fx.armed = true;
    fx.Load({Event(Step("armado"), {Step("condicion_del_futuro")}, {Note("a")})});
    fx.events.Update();
    CHECK(fx.log.empty());
}

TEST_CASE("una accion sin registrar se saltea y las siguientes se ejecutan") {
    EventFixture fx;
    fx.armed = true;
    fx.Load({Event(Step("armado"), {}, {Note("1"), Step("accion_del_futuro"), Note("2")})});
    CHECK_NOTHROW(fx.events.Update());
    CHECK(fx.log == std::vector<std::string>{"1", "2"});
}

TEST_CASE("las acciones se ejecutan en el orden del editor") {
    EventFixture fx;
    fx.armed = true;
    fx.Load({
        Event(Step("armado"), {}, {Note("a"), Note("b")}),
        Event(Step("armado"), {}, {Note("c")}),
    });
    fx.events.Update();
    CHECK(fx.log == std::vector<std::string>{"a", "b", "c"});
}

TEST_CASE("cada funcion recibe los params de su paso") {
    EventSystem events;
    json seenTrigger;
    json seenCondition;
    events.RegisterTrigger("t", [&seenTrigger](const json& params) { seenTrigger = params; return true; });
    events.RegisterCondition("c", [&seenCondition](const json& params) { seenCondition = params; return true; });
    json seenAction;
    events.RegisterAction("a", [&seenAction](const json& params) { seenAction = params; });
    events.LoadEvents({Event(Step("t", {{"x", 1}}), {Step("c", {{"y", 2}})}, {Step("a", {{"z", 3}})})});
    events.Update();
    CHECK(seenTrigger.at("x") == 1);
    CHECK(seenCondition.at("y") == 2);
    CHECK(seenAction.at("z") == 3);
}

TEST_CASE("cargar eventos reemplaza los anteriores y reinicia su memoria") {
    EventFixture fx;
    fx.armed = true;
    fx.Load({Event(Step("armado"), {}, {Note("viejo")})});
    fx.events.Update();

    // El mismo trigger sigue cumpliendose, pero el evento es de un nivel
    // nuevo: tiene que poder dispararse desde el primer frame.
    fx.Load({Event(Step("armado"), {}, {Note("nuevo")})});
    fx.events.Update();
    CHECK(fx.log == std::vector<std::string>{"viejo", "nuevo"});

    fx.Load({});
    fx.events.Update();
    CHECK(fx.log.size() == 2);
}

TEST_CASE("registrar un type de nuevo reemplaza la funcion anterior") {
    EventSystem events;
    int first = 0;
    int second = 0;
    events.RegisterTrigger("t", [](const json&) { return true; });
    events.RegisterAction("a", [&first](const json&) { ++first; });
    events.RegisterAction("a", [&second](const json&) { ++second; });
    events.LoadEvents({Event(Step("t"), {}, {Step("a")})});
    events.Update();
    CHECK(first == 0);
    CHECK(second == 1);
}

TEST_CASE("cada evento recuerda por separado si ya se cumplia") {
    EventSystem events;
    bool a = false;
    bool b = false;
    std::vector<std::string> log;
    events.RegisterTrigger("a", [&a](const json&) { return a; });
    events.RegisterTrigger("b", [&b](const json&) { return b; });
    events.RegisterAction("anotar", [&log](const json& params) { log.push_back(params.at("n").get<std::string>()); });
    events.LoadEvents({
        Event(Step("a"), {}, {Step("anotar", {{"n", "a"}})}),
        Event(Step("b"), {}, {Step("anotar", {{"n", "b"}})}),
    });
    a = true;
    events.Update();
    b = true;
    events.Update();
    CHECK(log == std::vector<std::string>{"a", "b"});
}

}  // TEST_SUITE
