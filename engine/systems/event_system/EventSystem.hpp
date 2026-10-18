#pragma once

#include <cstddef>
#include <exception>
#include <functional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "nlohmann/json.hpp"

using TriggerFn = std::function<bool(const nlohmann::json& params)>;
using ConditionFn = std::function<bool(const nlohmann::json& params)>;
using ActionFn = std::function<void(const nlohmann::json& params)>;

// Un paso individual (trigger, condicion o accion) tal como aparece en el
// nivel: "type" coincide con un ID de schema/event_catalog.json, "params" son
// los parametros que la persona configuro en el editor para ese bloque.
struct EventStep {
    std::string type;
    nlohmann::json params;
};

struct EventDefinition {
    EventStep trigger;
    std::vector<EventStep> conditions;
    std::vector<EventStep> actions;
};

// Motor de eventos "condicion-accion" sin codigo. El comportamiento real de
// cada "type" del catalogo se registra una sola vez en C++ (RegisterTrigger/
// RegisterCondition/RegisterAction); agregar un bloque nuevo al catalogo del
// editor no requiere tocar esta clase ni recompilar por cada nivel.
class EventSystem {
public:
    void RegisterTrigger(const std::string& type, TriggerFn fn);
    void RegisterCondition(const std::string& type, ConditionFn fn);
    void RegisterAction(const std::string& type, ActionFn fn);

    void LoadEvents(std::vector<EventDefinition> events);

    // Evalua todos los eventos cargados. Un evento ejecuta sus acciones UNA
    // vez, en el frame en que su trigger y todas sus condiciones PASAN a
    // cumplirse; mientras sigan cumpliendose no vuelve a hacerlo, y para
    // repetirse tiene que dejar de cumplirse primero. Un type sin registrar se
    // ignora (no rompe el nivel).
    //
    // Las acciones no deben llamar a LoadEvents: reemplazarian la lista que
    // se esta recorriendo. Pasar de nivel se agenda y se hace fuera de Update.
    void Update();

    // --- Recompensas que no se repiten ----------------------------------------
    //
    // Al continuar una partida el nivel arranca de nuevo y los enemigos
    // reaparecen, asi que "Al vencer al jefe" se puede volver a cumplir. Sin
    // esto, el evento volveria a dar su recompensa. Un evento cuyo trigger es
    // de "una sola vez" (oneShotTriggers: vencer, limpiar, juntar...) y que YA
    // se disparo, si vuelve a dispararse saltea las acciones de recompensa
    // (rewardActions: dar objeto, sumar monedas...). El resto de sus acciones
    // corre igual: abrir la puerta otra vez no da nada, y no hacerlo trabaria
    // el nivel. Lo llena EventBindings, que es quien sabe que es cada type.
    void SetNonRepeatable(std::unordered_set<std::string> oneShotTriggers,
                          std::unordered_set<std::string> rewardActions);

    // Una clave por evento cargado, estable entre una ejecucion y otra: sale del
    // contenido del evento (trigger, condiciones y acciones), no de su posicion,
    // asi que editar OTRO evento del nivel no la cambia. Dos eventos identicos
    // se distinguen por el orden ("#2").
    std::vector<std::string> Keys() const;

    // Las claves de los eventos que ya ejecutaron sus acciones (para guardar la
    // partida), y marcarlos como ya disparados al continuarla. Una clave que no
    // es de ningun evento cargado (el nivel se edito) se ignora.
    std::vector<std::string> FiredKeys() const;
    void RestoreFired(const std::vector<std::string>& keys);

private:
    bool IsActive(const EventDefinition& event) const;
    // Avisa por consola que un bloque del evento "index" lanzo una excepcion.
    // Una sola vez por evento: un trigger roto se evalua en cada frame.
    void ReportFailure(std::size_t index, const std::string& what, const std::exception& error);

    std::unordered_map<std::string, TriggerFn> triggers_;
    std::unordered_map<std::string, ConditionFn> conditions_;
    std::unordered_map<std::string, ActionFn> actions_;
    std::vector<EventDefinition> events_;
    // En paralelo a events_: si cada evento ya se cumplia el frame anterior.
    std::vector<bool> wasActive_;
    // En paralelo a events_: si cada evento ya ejecuto sus acciones alguna vez.
    std::vector<bool> fired_;
    // En paralelo a events_: si ya se aviso que el evento fallo.
    std::vector<bool> reported_;
    std::unordered_set<std::string> oneShotTriggers_;
    std::unordered_set<std::string> rewardActions_;
};
