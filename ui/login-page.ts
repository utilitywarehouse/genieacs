import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components";
import * as store from "./store";
import * as notifications from "./notifications";
import * as overlay from "./overlay";
import changePasswordComponent from "./change-password-component";

export function init(args): Promise<{}> {
  return Promise.resolve(args);
}

export const component: ClosureComponent = (): Component => {
  return {
    view: vnode => {
      if (window.username) m.route.set(vnode.attrs["continue"] || "/");

      document.title = "Login - GenieACS";
      return [
        m("h1", "Log in"),
        m(
          "form",
          m(
            "p",
            m("label", { for: "username" }, "Username"),
            m("input", {
              name: "username",
              type: "text",
              value: vnode.state["username"],
              oncreate: vnode2 => {
                (vnode2.dom as HTMLInputElement).focus();
              },
              oninput: m.withAttr("value", v => (vnode.state["username"] = v))
            })
          ),
          m(
            "p",
            m("label", { for: "password" }, "Password"),
            m("input", {
              name: "password",
              type: "password",
              value: vnode.state["password"],
              oninput: m.withAttr("value", v => (vnode.state["password"] = v))
            })
          ),
          m(
            "p",
            m(
              "button.primary",
              {
                type: "submit",
                onclick: e => {
                  e.target.disabled = true;
                  store
                    .logIn(vnode.state["username"], vnode.state["password"])
                    .then(() => {
                      location.reload();
                    })
                    .catch(err => {
                      notifications.push("error", err.message);
                      e.target.disabled = false;
                    });
                  return false;
                }
              },
              "Login"
            )
          )
        ),
        m(
          "a",
          {
            onclick: () => {
              const cb = (): Children => {
                const attrs = {
                  onPasswordChange: () => {
                    overlay.close(cb);
                    m.redraw();
                  }
                };
                return m(changePasswordComponent, attrs);
              };
              overlay.open(cb);
            }
          },
          "Change password"
        )
      ];
    }
  };
};
