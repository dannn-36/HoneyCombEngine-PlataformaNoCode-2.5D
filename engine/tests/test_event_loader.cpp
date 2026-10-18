// Pruebas de EventLoader: la traduccion del array "events" del nivel a
// EventDefinition. Sin estado y sin GPU: solo parseo.

#include "doctest/doctest.h"

#include "nlohmann/json.hpp"

#include "loader/EventLoader.hpp"

using nlohmann::json;

TEST_SUITE("cargador de eventos") {

TEST_CASE("un array vacio no da eventos") {
    CHECK(EventLoader::Parse(json::array()).empty());
}

TEST_CASE("un evento completo conserva trigger condiciones y acciones") {
    const json events = json::array({{
        {"trigger", {{"type", "on_collision"}, {"params", {{"entityA", "jugador"}, {"entityB", "llave"}}}}},
        {"conditions", json::array({{{"type", "flag_is_not_set"}, {"params", {{"flag", "abierta"}}}}})},
        {"actions", json::array({
            {{"type", "set_flag"}, {"params", {{"flag", "abierta"}}}},
            {{"type", "destroy_entity"}, {"params", {{"entity", "llave"}}}},
        })},
    }});
    const auto parsed = EventLoader::Parse(events);
    REQUIRE(parsed.size() == 1);
    const EventDefinition& event = parsed[0];
    CHECK(event.trigger.type == "on_collision");
    CHECK(event.trigger.params.at("entityB") == "llave");
    REQUIRE(event.conditions.size() == 1);
    CHECK(event.conditions[0].type == "flag_is_not_set");
    REQUIRE(event.actions.size() == 2);
    // El orden es el que eligio la persona en el editor.
    CHECK(event.actions[0].type == "set_flag");
    CHECK(event.actions[1].type == "destroy_entity");
    CHECK(event.actions[1].params.at("entity") == "llave");
}

TEST_CASE("los eventos se devuelven en el orden del archivo") {
    const json events = json::array({
        {{"trigger", {{"type", "primero"}}}},
        {{"trigger", {{"type", "segundo"}}}},
        {{"trigger", {{"type", "tercero"}}}},
    });
    const auto parsed = EventLoader::Parse(events);
    REQUIRE(parsed.size() == 3);
    CHECK(parsed[0].trigger.type == "primero");
    CHECK(parsed[2].trigger.type == "tercero");
}

TEST_CASE("condiciones y acciones son opcionales") {
    const auto parsed = EventLoader::Parse(json::array({{{"trigger", {{"type", "on_start"}}}}}));
    REQUIRE(parsed.size() == 1);
    CHECK(parsed[0].conditions.empty());
    CHECK(parsed[0].actions.empty());
}

TEST_CASE("un paso sin params queda con un objeto vacio") {
    const auto parsed = EventLoader::Parse(json::array({{
        {"trigger", {{"type", "on_start"}}},
        {"actions", json::array({{{"type", "show_message"}}})},
    }}));
    REQUIRE(parsed.size() == 1);
    CHECK(parsed[0].trigger.params.is_object());
    CHECK(parsed[0].trigger.params.empty());
    REQUIRE(parsed[0].actions.size() == 1);
    CHECK(parsed[0].actions[0].params.is_object());
}

TEST_CASE("un evento sin trigger se rechaza con un mensaje") {
    const json events = json::array({{{"actions", json::array()}}});
    CHECK_THROWS_WITH_AS(EventLoader::Parse(events), doctest::Contains("trigger"), json::out_of_range);
}

TEST_CASE("un paso sin type se rechaza con un mensaje") {
    CHECK_THROWS_WITH_AS(EventLoader::Parse(json::array({{{"trigger", {{"params", json::object()}}}}})),
                         doctest::Contains("type"), json::out_of_range);
    const json badAction = json::array({{
        {"trigger", {{"type", "on_start"}}},
        {"actions", json::array({{{"params", json::object()}}})},
    }});
    CHECK_THROWS_WITH_AS(EventLoader::Parse(badAction), doctest::Contains("type"), json::out_of_range);
}

TEST_CASE("un type que no es texto se rechaza con un mensaje") {
    CHECK_THROWS_AS(EventLoader::Parse(json::array({{{"trigger", {{"type", 3}}}}})), json::type_error);
}

}  // TEST_SUITE
