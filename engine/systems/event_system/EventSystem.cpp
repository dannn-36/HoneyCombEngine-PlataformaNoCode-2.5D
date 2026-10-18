// Implementacion de EventSystem: el motor NoCode de "cuando pase X, si se
// cumple Y, haces Z". El contrato de la clase esta documentado en el .hpp.
//
// Los Register* de abajo son la tabla de traduccion entre el catalogo del
// editor y el codigo C++: la clave es el "type" que aparece en el JSON del
// nivel, y el valor es la funcion que lo ejecuta. Se llenan una sola vez al
// arrancar (ver main.cpp); despues solo se consultan.

#include "EventSystem.hpp"

#include <cstdint>
#include <exception>
#include <iostream>

void EventSystem::RegisterTrigger(const std::string& type, TriggerFn fn) {
    triggers_[type] = std::move(fn);
}

void EventSystem::RegisterCondition(const std::string& type, ConditionFn fn) {
    conditions_[type] = std::move(fn);
}

void EventSystem::RegisterAction(const std::string& type, ActionFn fn) {
    actions_[type] = std::move(fn);
}

// Reemplaza los eventos cargados (no los suma): cargar un nivel nuevo tiene que
// dejar afuera los del anterior. El recuerdo de "ya se cumplia" arranca en
// falso para todos, asi un evento del nivel nuevo puede dispararse desde el
// primer frame.
void EventSystem::LoadEvents(std::vector<EventDefinition> events) {
    events_ = std::move(events);
    wasActive_.assign(events_.size(), false);
    fired_.assign(events_.size(), false);
    reported_.assign(events_.size(), false);
}

void EventSystem::SetNonRepeatable(std::unordered_set<std::string> oneShotTriggers,
                                   std::unordered_set<std::string> rewardActions) {
    oneShotTriggers_ = std::move(oneShotTriggers);
    rewardActions_ = std::move(rewardActions);
}

namespace {

// FNV-1a de 64 bits: un hash que da lo mismo en cualquier compilacion. No se
// usa std::hash porque el estandar no promete que sea igual entre binarios, y
// la clave tiene que valer en la partida que guardo OTRO ejecutable (Debug o
// Release, una version anterior del motor).
std::string Fnv1a(const std::string& text) {
    std::uint64_t hash = 14695981039346656037ull;
    for (const unsigned char c : text) {
        hash ^= c;
        hash *= 1099511628211ull;
    }
    static const char* const kHex = "0123456789abcdef";
    std::string out(16, '0');
    for (int i = 15; i >= 0; --i) {
        out[static_cast<std::size_t>(i)] = kHex[hash & 0xF];
        hash >>= 4;
    }
    return out;
}

nlohmann::json StepJson(const EventStep& step) {
    return nlohmann::json{{"type", step.type}, {"params", step.params}};
}

}  // namespace

std::vector<std::string> EventSystem::Keys() const {
    std::vector<std::string> keys;
    keys.reserve(events_.size());
    std::unordered_map<std::string, int> seen;
    for (const auto& event : events_) {
        nlohmann::json content{{"trigger", StepJson(event.trigger)},
                               {"conditions", nlohmann::json::array()},
                               {"actions", nlohmann::json::array()}};
        for (const auto& step : event.conditions) content["conditions"].push_back(StepJson(step));
        for (const auto& step : event.actions) content["actions"].push_back(StepJson(step));
        // dump() ordena las claves de los objetos: la misma configuracion da
        // el mismo texto aunque el JSON del nivel las tenga en otro orden.
        const std::string hash = Fnv1a(content.dump());
        const int occurrence = ++seen[hash];
        keys.push_back(occurrence == 1 ? hash : hash + "#" + std::to_string(occurrence));
    }
    return keys;
}

std::vector<std::string> EventSystem::FiredKeys() const {
    const std::vector<std::string> keys = Keys();
    std::vector<std::string> fired;
    for (std::size_t index = 0; index < keys.size(); ++index) {
        if (fired_[index]) {
            fired.push_back(keys[index]);
        }
    }
    return fired;
}

void EventSystem::RestoreFired(const std::vector<std::string>& keys) {
    const std::unordered_set<std::string> wanted(keys.begin(), keys.end());
    const std::vector<std::string> all = Keys();
    for (std::size_t index = 0; index < all.size(); ++index) {
        if (wanted.count(all[index]) > 0) {
            fired_[index] = true;
        }
    }
}

// true si el trigger dispara y se cumplen TODAS las condiciones.
bool EventSystem::IsActive(const EventDefinition& event) const {
    // Trigger. Un type sin registrar se trata como "no dispara": un nivel que
    // use un bloque que este binario no conoce sigue corriendo en vez de
    // romper. Ese perdon es lo que permite que el catalogo del editor y el
    // motor evolucionen a distinto ritmo.
    auto triggerIt = triggers_.find(event.trigger.type);
    if (triggerIt == triggers_.end() || !triggerIt->second(event.trigger.params)) {
        return false;
    }

    // Condiciones: se exigen TODAS (AND), y se corta en la primera que falle.
    // Una condicion sin registrar cuenta como no cumplida, que es el lado
    // seguro: ante la duda no se ejecuta.
    for (const auto& condition : event.conditions) {
        auto conditionIt = conditions_.find(condition.type);
        if (conditionIt == conditions_.end() || !conditionIt->second(condition.params)) {
            return false;
        }
    }
    return true;
}

// Se llama una vez por frame. Recorre los eventos del nivel en el orden en que
// los guardo el editor y ejecuta los que EMPIEZAN a cumplirse.
//
// Antes se ejecutaban en cada frame mientras se cumplieran. Con "destruir"
// daba igual, pero "Al eliminar una entidad -> pasar de nivel" o "al tocar ->
// reproducir sonido" se repetian sesenta veces por segundo. Un evento de
// NoCode se lee como "cuando pase X", y eso es un instante, no un estado.
void EventSystem::Update() {
    // Por indice y no con for-each: wasActive_ va en paralelo a events_.
    for (std::size_t index = 0; index < events_.size(); ++index) {
        const EventDefinition& event = events_[index];
        bool active = false;
        try {
            active = IsActive(event);
        } catch (const std::exception& error) {
            // Un bloque que falla (un parametro con un tipo que no esperaba,
            // por ejemplo) no tiene que cerrar el juego: ese evento cuenta como
            // que no se cumple. Se avisa una vez y no en cada frame.
            ReportFailure(index, "su trigger o una condicion", error);
            active = false;
        }
        const bool starts = active && !wasActive_[index];
        wasActive_[index] = active;
        if (!starts) {
            continue;
        }

        // Un evento de "una sola vez" que ya dio su recompensa no la vuelve a
        // dar (ver SetNonRepeatable). Se decide ANTES de marcarlo disparado.
        const bool skipRewards = fired_[index] && oneShotTriggers_.count(event.trigger.type) > 0;
        fired_[index] = true;

        // Acciones: en el orden en que el usuario las puso en el editor. Una
        // accion desconocida se saltea sin cortar las siguientes.
        for (const auto& action : event.actions) {
            if (skipRewards && rewardActions_.count(action.type) > 0) {
                continue;
            }
            auto actionIt = actions_.find(action.type);
            if (actionIt == actions_.end()) {
                continue;
            }
            // Lo mismo con una accion: se saltea esa y siguen las demas.
            try {
                actionIt->second(action.params);
            } catch (const std::exception& error) {
                ReportFailure(index, "la accion \"" + action.type + "\"", error);
            }
        }
    }
}

void EventSystem::ReportFailure(std::size_t index, const std::string& what, const std::exception& error) {
    if (reported_[index]) {
        return;
    }
    reported_[index] = true;
    std::cerr << "El evento " << (index + 1) << " (\"" << events_[index].trigger.type << "\") fallo en " << what
              << " y se saltea: " << error.what() << std::endl;
}
